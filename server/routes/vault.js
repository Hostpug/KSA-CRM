'use strict';
// Password vault: client portal logins (GST, Income tax, TRACES, …).
// - Passwords and notes are encrypted (server/vault.js); lists never include them.
// - Revealing needs the vault to be unlocked with the user's own password (10 minutes).
// - Staff see only clients they handle or have open work / notices for.
// - Every reveal, copy, change and delete is written to the audit log.
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const vault = require('../vault');
const { audit } = require('../audit');
const { check, reject, idParam } = require('../validate');

const router = express.Router();
const UNLOCK_MINUTES = 10;

const PORTALS = {
  gst: { name: 'GST portal', url: 'https://services.gst.gov.in/services/login' },
  it: { name: 'Income tax e-filing', url: 'https://eportal.incometax.gov.in/iec/foservices/#/login' },
  traces: { name: 'TRACES (TDS)', url: 'https://www.tdscpc.gov.in/app/login.xhtml' },
  ewb: { name: 'E-way bill', url: 'https://ewaybillgst.gov.in/Login.aspx' },
  einv: { name: 'E-invoice (IRP)', url: 'https://einvoice1.gst.gov.in/' },
  mca: { name: 'MCA', url: 'https://www.mca.gov.in/content/mca/global/en/foportal/fologin.html' },
  epfo: { name: 'EPFO (employer)', url: 'https://unifiedportal-emp.epfindia.gov.in/epfo/' },
  esic: { name: 'ESIC', url: 'https://portal.esic.gov.in/EmployerPortal/ESICInsurancePortal/Portal_Loginnew.aspx' },
  pt: { name: 'Professional tax', url: '' },
  bank: { name: 'Bank / net banking', url: '' },
  other: { name: 'Other', url: '' },
};

const SPEC = {
  client_id: { label: 'Client', type: 'int', required: true },
  portal: { label: 'Portal', required: true, oneOf: Object.keys(PORTALS) },
  label: { label: 'Label', max: 120 },
  username: { label: 'User ID', required: true, max: 160 },
  reg_mobile: { label: 'Registered mobile', format: 'mobile', max: 20 },
  reg_email: { label: 'Registered email', format: 'email', max: 190, lower: true },
  url: { label: 'Login URL', max: 250 },
  changed_on: { label: 'Password changed on', format: 'date' },
};

// ---------- who can see what ----------
// Staff: clients they handle, or with an open task / notice assigned to or reviewed by them.
const STAFF_SCOPE = `(c.assigned_to = ?
  OR EXISTS (SELECT 1 FROM engagements g WHERE g.client_id = c.id AND g.stage BETWEEN 2 AND 7 AND (g.assigned_to = ? OR g.reviewer_id = ?))
  OR EXISTS (SELECT 1 FROM notices n WHERE n.client_id = c.id AND n.stage < 8 AND (n.assigned_to = ? OR n.reviewer_id = ?)))`;
const scope = (user) => (user.role === 'staff' ? { sql: STAFF_SCOPE, params: Array(5).fill(user.id) } : { sql: '1 = 1', params: [] });

async function canAccessClient(user, clientId) {
  const s = scope(user);
  return !!(await db.one(`SELECT c.id FROM clients c WHERE c.id = ? AND ${s.sql}`, [clientId, ...s.params]));
}

const SELECT = `SELECT v.id, v.client_id, c.name AS client_name, v.portal, v.label, v.username, v.reg_mobile, v.reg_email, v.url,
    v.changed_on, v.revision, v.updated_at, v.created_at, (v.secret IS NOT NULL) AS has_password, (v.notes_secret IS NOT NULL) AS has_notes,
    cb.name AS created_by_name, ub.name AS updated_by_name
  FROM vault_items v JOIN clients c ON c.id = v.client_id
  LEFT JOIN employees cb ON cb.id = v.created_by LEFT JOIN employees ub ON ub.id = v.updated_by`;
const shape = (r) => ({
  ...r, revision: Number(r.revision), has_password: !!Number(r.has_password), has_notes: !!Number(r.has_notes),
  portal_name: PORTALS[r.portal]?.name || r.portal, login_url: r.url || PORTALS[r.portal]?.url || '',
});
const who = (r) => `${PORTALS[r.portal]?.name || r.portal} login of ${r.client_name}${r.label ? ` (${r.label})` : ''}`;

function needKey(req, res, next) {
  if (vault.ready()) return next();
  res.status(503).json({ error: 'The vault is not set up on this server yet (VAULT_KEY missing). Ask the administrator.' });
}
router.use(needKey);

// ---------- lock / unlock ----------
const failures = new Map(); // sessionId -> { n, until }

router.get('/status', async (req, res) => {
  const r = await db.one('SELECT GREATEST(TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), vault_until), 0) AS secs FROM sessions WHERE id = ?', [req.sessionId]);
  res.json({ unlocked: req.vaultOpen, seconds: req.vaultOpen ? Number(r?.secs || 0) : 0, portals: PORTALS });
});

router.post('/unlock', async (req, res) => {
  const f = failures.get(req.sessionId);
  if (f && f.n >= 5 && f.until > Date.now()) return res.status(429).json({ error: 'Too many wrong attempts. Try again in a few minutes.' });
  const emp = await db.one('SELECT password_hash FROM employees WHERE id = ?', [req.user.id]);
  const ok = emp && (await auth.verifyPassword(String(req.body?.password || ''), emp.password_hash));
  if (!ok) {
    const n = (f && f.until > Date.now() ? f.n : 0) + 1;
    failures.set(req.sessionId, { n, until: Date.now() + 15 * 60 * 1000 });
    await audit(req, 'vault.unlock_failed', { entity: 'vault', summary: 'Wrong password while unlocking the vault' });
    return reject(res, { password: 'That password is not correct.' });
  }
  failures.delete(req.sessionId);
  await db.q('UPDATE sessions SET vault_until = UTC_TIMESTAMP() + INTERVAL ? MINUTE WHERE id = ?', [UNLOCK_MINUTES, req.sessionId]);
  await audit(req, 'vault.unlocked', { entity: 'vault', summary: 'Unlocked the password vault' });
  res.json({ unlocked: true, seconds: UNLOCK_MINUTES * 60 });
});

router.post('/lock', async (req, res) => {
  await db.q('UPDATE sessions SET vault_until = NULL WHERE id = ?', [req.sessionId]);
  res.json({ unlocked: false });
});

// ---------- list ----------
router.get('/', async (req, res) => {
  const s = scope(req.user);
  const where = [s.sql];
  const params = [...s.params];
  const clientId = idParam(req.query.client_id);
  if (clientId) { where.push('v.client_id = ?'); params.push(clientId); }
  if (req.query.portal && PORTALS[req.query.portal]) { where.push('v.portal = ?'); params.push(req.query.portal); }
  const term = String(req.query.q || '').trim().slice(0, 80);
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    where.push('(c.name LIKE ? OR v.username LIKE ? OR v.label LIKE ? OR c.gstin LIKE ? OR c.pan LIKE ?)');
    params.push(like, like, like, like, like);
  }
  const rows = await db.q(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY c.name, FIELD(v.portal, ${Object.keys(PORTALS).map(() => '?').join(', ')}), v.label LIMIT 500`,
    [...params, ...Object.keys(PORTALS)]);
  res.json({ items: rows.map(shape), unlocked: req.vaultOpen, portals: PORTALS });
});

// ---------- reveal (password + notes) ----------
router.post('/:id/reveal', async (req, res) => {
  const id = idParam(req.params.id);
  const row = id && (await db.one(`${SELECT.replace('v.changed_on,', 'v.changed_on, v.secret, v.notes_secret,')} WHERE v.id = ?`, [id]));
  if (!row || !(await canAccessClient(req.user, row.client_id))) return res.status(404).json({ error: 'Login not found.' });
  if (!req.vaultOpen) return res.status(423).json({ error: 'Unlock the vault first.', code: 'VAULT_LOCKED' });
  let password; let notes;
  try { password = vault.decrypt(row.secret); notes = vault.decrypt(row.notes_secret); } catch (err) {
    console.error('[vault] decrypt failed for item', id, err.message);
    return res.status(500).json({ error: 'This password cannot be decrypted with the current key. Ask the administrator.' });
  }
  const purpose = req.body?.purpose === 'copy' ? 'copied' : 'viewed';
  await audit(req, `vault.${purpose}`, { entity: 'vault', entityId: id, summary: `${purpose === 'copied' ? 'Copied' : 'Viewed'} the ${who(row)}` });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ password, notes });
});

// ---------- access log for one login (Owner / Admin) ----------
router.get('/:id/log', auth.requireRole('owner', 'admin'), async (req, res) => {
  const id = idParam(req.params.id);
  const rows = await db.q("SELECT at, actor_name, action, summary, ip FROM audit_log WHERE entity = 'vault' AND entity_id = ? ORDER BY id DESC LIMIT 100", [String(id)]);
  res.json({ items: rows });
});

// ---------- add / change / delete ----------
function secretsFrom(body) {
  const password = typeof body?.password === 'string' ? body.password : undefined;
  const notes = typeof body?.notes === 'string' ? body.notes.replace(/\r\n/g, '\n').trim() : undefined;
  if (password !== undefined && password.length > 200) return { error: { password: 'Password is too long.' } };
  if (notes !== undefined && notes.length > 2000) return { error: { notes: 'Notes are too long (2000 characters).' } };
  return { password, notes };
}

router.post('/', async (req, res) => {
  const { data, errors, ok } = check(req.body, SPEC);
  const sec = secretsFrom(req.body);
  if (sec.error) Object.assign(errors, sec.error);
  if (!sec.password) errors.password = 'Enter the password.';
  if (data.url && !/^https?:\/\/[^\s]+$/i.test(data.url)) errors.url = 'Enter a web address starting with https://';
  if (!ok || Object.keys(errors).length) return reject(res, errors);
  if (!(await canAccessClient(req.user, data.client_id))) return reject(res, { client_id: 'You do not have access to this client.' });
  const r = await db.q(
    `INSERT INTO vault_items (client_id, portal, label, username, secret, notes_secret, reg_mobile, reg_email, url, changed_on, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.client_id, data.portal, data.label, data.username, vault.encrypt(sec.password), vault.encrypt(sec.notes), data.reg_mobile, data.reg_email, data.url, data.changed_on, req.user.id, req.user.id],
  );
  const item = shape(await db.one(`${SELECT} WHERE v.id = ?`, [r.insertId]));
  await audit(req, 'vault.created', { entity: 'vault', entityId: r.insertId, summary: `Saved the ${who(item)}` });
  res.status(201).json({ item });
});

router.put('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const before = id && (await db.one(`${SELECT} WHERE v.id = ?`, [id]));
  if (!before || !(await canAccessClient(req.user, before.client_id))) return res.status(404).json({ error: 'Login not found.' });
  if (Number(req.body?.revision) !== Number(before.revision)) return res.status(409).json({ error: 'Someone else changed this login. Reload to see the latest.' });
  const { data, errors, ok } = check(req.body, SPEC);
  const sec = secretsFrom(req.body);
  if (sec.error) Object.assign(errors, sec.error);
  if (data.url && !/^https?:\/\/[^\s]+$/i.test(data.url)) errors.url = 'Enter a web address starting with https://';
  if (!ok || Object.keys(errors).length) return reject(res, errors);
  if (data.client_id !== before.client_id && !(await canAccessClient(req.user, data.client_id))) return reject(res, { client_id: 'You do not have access to this client.' });
  const sets = ['client_id = ?', 'portal = ?', 'label = ?', 'username = ?', 'reg_mobile = ?', 'reg_email = ?', 'url = ?', 'changed_on = ?', 'updated_by = ?', 'revision = revision + 1'];
  const vals = [data.client_id, data.portal, data.label, data.username, data.reg_mobile, data.reg_email, data.url, data.changed_on, req.user.id];
  // A blank password box means "keep the current password".
  const pwChanged = !!sec.password;
  if (pwChanged) { sets.push('secret = ?'); vals.push(vault.encrypt(sec.password)); }
  if (sec.notes !== undefined && req.body.notes_changed) { sets.push('notes_secret = ?'); vals.push(vault.encrypt(sec.notes)); }
  await db.q(`UPDATE vault_items SET ${sets.join(', ')} WHERE id = ? AND revision = ?`, [...vals, id, before.revision]);
  const item = shape(await db.one(`${SELECT} WHERE v.id = ?`, [id]));
  await audit(req, 'vault.updated', { entity: 'vault', entityId: id, summary: `${pwChanged ? 'Changed the password of' : 'Updated'} the ${who(item)}` });
  res.json({ item });
});

router.delete('/:id', auth.requireRole('owner', 'admin'), async (req, res) => {
  const id = idParam(req.params.id);
  const row = id && (await db.one(`${SELECT} WHERE v.id = ?`, [id]));
  if (!row) return res.status(404).json({ error: 'Login not found.' });
  await db.q('DELETE FROM vault_items WHERE id = ?', [id]);
  await audit(req, 'vault.deleted', { entity: 'vault', entityId: id, summary: `Deleted the ${who(row)}` });
  res.json({ ok: true });
});

module.exports = router;
