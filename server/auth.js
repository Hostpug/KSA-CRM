'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./db');
const config = require('./config');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'ksa_sid';
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

// ---------- passwords (Node's built-in scrypt: no native npm build needed) ----------

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// A fixed hash so unknown emails take as long as known ones.
let dummyHash = null;
async function burnTime(password) {
  if (!dummyHash) dummyHash = await hashPassword('not-a-real-password');
  await verifyPassword(password, dummyHash);
}

/** Returns an error message, or null when the password is acceptable. */
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.';
  if (pw.length > 128) return 'Password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain letters and numbers.';
  return null;
}

/** Readable temporary password, e.g. "Kx7m-Pq4t-Wz9r". */
function tempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += alphabet[bytes[i] % alphabet.length];
    if (i === 3 || i === 7) s += '-';
  }
  // guarantee letters + digits
  return /[0-9]/.test(s) ? s : s.slice(0, -1) + '7';
}

// ---------- sessions ----------

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieAttrs(req, maxAgeSec) {
  const secure = req.secure || config.isProd;
  return [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAgeSec}`, secure ? 'Secure' : ''].filter(Boolean).join('; ');
}

async function createSession(req, res, employee) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(32).toString('base64url');
  const hours = config.sessionHours;
  await db.q(
    `INSERT INTO sessions (id, employee_id, auth_version, csrf, ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP() + INTERVAL ? HOUR)`,
    [sha256(token), employee.id, employee.auth_version, csrf, req.ip, String(req.get('user-agent') || '').slice(0, 255), hours]
  );
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieAttrs(req, hours * 3600)}`);
  return csrf;
}

async function destroySession(req, res) {
  if (req.sessionId) await db.q('DELETE FROM sessions WHERE id = ?', [req.sessionId]);
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(req, 0)}`);
}

/** Attach req.user + req.session when the cookie is valid. Never rejects by itself. */
async function loadSession(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token || token.length > 100) return next();
    const id = sha256(token);
    const row = await db.one(
      `SELECT s.id AS sid, s.csrf, s.vault_until > UTC_TIMESTAMP() AS vault_open, e.id, e.name, e.email, e.role, e.designation, e.must_change_pw
         FROM sessions s JOIN employees e ON e.id = s.employee_id
        WHERE s.id = ? AND s.expires_at > UTC_TIMESTAMP()
          AND e.active = 1 AND s.auth_version = e.auth_version`,
      [id]
    );
    if (row) {
      req.sessionId = row.sid;
      req.csrf = row.csrf;
      req.vaultOpen = !!Number(row.vault_open);
      req.user = {
        id: row.id, name: row.name, email: row.email, role: row.role,
        designation: row.designation, mustChangePassword: !!row.must_change_pw,
      };
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Requires a signed-in user; blocks everything except password change until a temp password is replaced. */
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (req.user.mustChangePassword && !req.allowWithTempPassword) {
    return res.status(403).json({ error: 'Please set a new password first.', code: 'MUST_CHANGE_PASSWORD' });
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    const sent = req.get('x-csrf-token') || '';
    const ok = sent.length === req.csrf.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.csrf));
    if (!ok) return res.status(403).json({ error: 'Session check failed. Please reload the page.', code: 'CSRF' });
  }
  next();
}

function allowTempPassword(req, res, next) {
  req.allowWithTempPassword = true;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this section.' });
    }
    next();
  };
}

/** Remove expired sessions now and then. */
async function purgeExpiredSessions() {
  await db.q('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()');
}

module.exports = {
  COOKIE, MAX_FAILED, LOCK_MINUTES,
  hashPassword, verifyPassword, burnTime, passwordProblem, tempPassword,
  createSession, destroySession, loadSession, requireAuth, allowTempPassword, requireRole, purgeExpiredSessions,
};
