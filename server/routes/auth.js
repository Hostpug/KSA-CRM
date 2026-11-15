'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { audit } = require('../audit');
const { rateLimit } = require('../security');

const router = express.Router();

// 20 login tries per IP per 15 minutes, on top of the per-account lockout.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, message: 'Too many sign-in attempts. Please wait 15 minutes.' });

async function firmInfo() {
  const rows = await db.q("SELECT k, v FROM settings WHERE k IN ('firm_name','firm_tagline')");
  const s = Object.fromEntries(rows.map((r) => [r.k, r.v]));
  return { name: s.firm_name || 'Practice CRM', tagline: s.firm_tagline || '' };
}

router.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 190);
  const password = String(req.body?.password || '').slice(0, 200);
  const fail = () => res.status(401).json({ error: 'Email or password is incorrect.' });
  if (!email || !password) return res.status(422).json({ error: 'Enter your email and password.' });

  const emp = await db.one(
    `SELECT id, name, email, role, active, password_hash, auth_version, failed_attempts,
            (locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP()) AS locked,
            TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), locked_until) AS lock_mins
       FROM employees WHERE email = ?`,
    [email]
  );
  if (!emp) { await auth.burnTime(password); return fail(); }
  if (Number(emp.locked)) {
    return res.status(423).json({ error: `Account locked after too many attempts. Try again in ${Math.max(1, Number(emp.lock_mins) + 1)} minutes.` });
  }

  const ok = await auth.verifyPassword(password, emp.password_hash);
  if (!ok || !emp.active) {
    if (emp.active) {
      const attempts = Number(emp.failed_attempts) + 1;
      if (attempts >= auth.MAX_FAILED) {
        await db.q('UPDATE employees SET failed_attempts = 0, locked_until = UTC_TIMESTAMP() + INTERVAL ? MINUTE WHERE id = ?', [auth.LOCK_MINUTES, emp.id]);
        await audit({ ip: req.ip }, 'auth.locked', { entity: 'employee', entityId: emp.id, summary: `${emp.name} locked after ${auth.MAX_FAILED} failed sign-ins` });
      } else {
        await db.q('UPDATE employees SET failed_attempts = ? WHERE id = ?', [attempts, emp.id]);
      }
    }
    return fail();
  }

  await db.q('UPDATE employees SET failed_attempts = 0, locked_until = NULL, last_login_at = UTC_TIMESTAMP() WHERE id = ?', [emp.id]);
  await auth.createSession(req, res, emp);
  req.user = { id: emp.id, name: emp.name };
  await audit(req, 'auth.login', { entity: 'employee', entityId: emp.id, summary: `${emp.name} signed in` });
  res.json({ ok: true });
});

router.post('/logout', auth.allowTempPassword, auth.requireAuth, async (req, res) => {
  await audit(req, 'auth.logout', { entity: 'employee', entityId: req.user.id, summary: `${req.user.name} signed out` });
  await auth.destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const firm = await firmInfo();
  if (!req.user) return res.status(401).json({ error: 'Please sign in.', firm });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ user: req.user, csrf: req.csrf, firm });
});

router.post('/password', auth.allowTempPassword, auth.requireAuth, async (req, res) => {
  const current = String(req.body?.current || '');
  const next = String(req.body?.next || '');
  const emp = await db.one('SELECT id, password_hash, auth_version FROM employees WHERE id = ?', [req.user.id]);
  if (!emp || !(await auth.verifyPassword(current, emp.password_hash))) {
    return res.status(422).json({ error: 'Current password is incorrect.', fields: { current: 'Current password is incorrect.' } });
  }
  const problem = auth.passwordProblem(next);
  if (problem) return res.status(422).json({ error: problem, fields: { next: problem } });
  if (current === next) return res.status(422).json({ error: 'Choose a password different from the current one.', fields: { next: 'Choose a different password.' } });

  const hash = await auth.hashPassword(next);
  // Bumping auth_version signs out every other device; then issue a fresh session here.
  await db.q('UPDATE employees SET password_hash = ?, must_change_pw = 0, auth_version = auth_version + 1 WHERE id = ?', [hash, emp.id]);
  await db.q('DELETE FROM sessions WHERE employee_id = ?', [emp.id]);
  await auth.createSession(req, res, { id: emp.id, auth_version: Number(emp.auth_version) + 1 });
  await audit(req, 'auth.password_changed', { entity: 'employee', entityId: emp.id, summary: `${req.user.name} changed their password` });
  res.json({ ok: true });
});

module.exports = router;
