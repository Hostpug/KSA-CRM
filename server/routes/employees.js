'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { audit, diff } = require('../audit');
const { check, reject, idParam } = require('../validate');

const router = express.Router();
const isManager = (u) => u.role === 'owner' || u.role === 'admin';

const PUBLIC_FIELDS = `id, name, email, mobile, designation, role, date_joined, dob, address,
  emergency_name, emergency_phone, active, must_change_pw, last_login_at, created_at,
  (locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP()) AS locked`;

const PROFILE_SPEC = {
  mobile: { label: 'Mobile', format: 'mobile', max: 20 },
  dob: { label: 'Date of birth', format: 'date' },
  address: { label: 'Address', max: 500, multiline: true },
  emergency_name: { label: 'Emergency contact name', max: 120 },
  emergency_phone: { label: 'Emergency contact number', format: 'mobile', max: 20 },
};

const FULL_SPEC = {
  name: { label: 'Name', required: true, max: 120 },
  email: { label: 'Email', required: true, format: 'email', max: 190, lower: true },
  designation: { label: 'Designation', max: 80 },
  role: { label: 'Role', required: true, oneOf: ['owner', 'admin', 'staff'] },
  date_joined: { label: 'Date of joining', format: 'date' },
  ...PROFILE_SPEC,
};

function shape(row) {
  if (!row) return row;
  return { ...row, active: !!Number(row.active), must_change_pw: !!Number(row.must_change_pw), locked: !!Number(row.locked) };
}

async function activeOwnerCount(excludeId) {
  const r = await db.one("SELECT COUNT(*) AS n FROM employees WHERE role = 'owner' AND active = 1 AND id <> ?", [excludeId || 0]);
  return Number(r.n);
}

// Names for dropdowns (everyone).
router.get('/options', async (req, res) => {
  res.json({ items: await db.q('SELECT id, name, designation FROM employees WHERE active = 1 ORDER BY name') });
});

// Own profile (everyone).
router.get('/me', async (req, res) => {
  res.json({ item: shape(await db.one(`SELECT ${PUBLIC_FIELDS} FROM employees WHERE id = ?`, [req.user.id])) });
});

router.put('/me', async (req, res) => {
  const { data, errors, ok } = check(req.body, PROFILE_SPEC);
  if (!ok) return reject(res, errors);
  const before = await db.one('SELECT * FROM employees WHERE id = ?', [req.user.id]);
  await db.q('UPDATE employees SET mobile = ?, dob = ?, address = ?, emergency_name = ?, emergency_phone = ? WHERE id = ?',
    [data.mobile, data.dob, data.address, data.emergency_name, data.emergency_phone, req.user.id]);
  await audit(req, 'employee.profile_updated', { entity: 'employee', entityId: req.user.id, summary: `${req.user.name} updated their profile`, detail: diff(before, data, Object.keys(PROFILE_SPEC)) });
  res.json({ item: shape(await db.one(`SELECT ${PUBLIC_FIELDS} FROM employees WHERE id = ?`, [req.user.id])) });
});

// ----- Owner & Admin below -----

router.get('/', async (req, res) => {
  if (!isManager(req.user)) return res.status(403).json({ error: 'Only Owner and Admin can see the team list.' });
  const rows = await db.q(`SELECT ${PUBLIC_FIELDS} FROM employees ORDER BY active DESC, FIELD(role,'owner','admin','staff'), name`);
  res.json({ items: rows.map(shape) });
});

router.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(404).json({ error: 'Not found.' });
  if (!isManager(req.user) && id !== req.user.id) return res.status(403).json({ error: 'You can only view your own profile.' });
  const row = await db.one(`SELECT ${PUBLIC_FIELDS} FROM employees WHERE id = ?`, [id]);
  if (!row) return res.status(404).json({ error: 'Employee not found.' });
  res.json({ item: shape(row) });
});

router.post('/', auth.requireRole('owner', 'admin'), async (req, res) => {
  const { data, errors, ok } = check(req.body, FULL_SPEC);
  if (!ok) return reject(res, errors);
  if (data.role === 'owner' && req.user.role !== 'owner') return reject(res, { role: 'Only an Owner can add another Owner.' });
  if (await db.one('SELECT id FROM employees WHERE email = ?', [data.email])) return reject(res, { email: 'An employee with this email already exists.' });

  const password = auth.tempPassword();
  const hash = await auth.hashPassword(password);
  const r = await db.q(
    `INSERT INTO employees (name, email, mobile, designation, role, date_joined, dob, address, emergency_name, emergency_phone, password_hash, must_change_pw, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [data.name, data.email, data.mobile, data.designation, data.role, data.date_joined, data.dob, data.address, data.emergency_name, data.emergency_phone, hash]
  );
  await audit(req, 'employee.created', { entity: 'employee', entityId: r.insertId, summary: `Added ${data.name} (${data.role})` });
  const item = shape(await db.one(`SELECT ${PUBLIC_FIELDS} FROM employees WHERE id = ?`, [r.insertId]));
  res.status(201).json({ item, tempPassword: password });
});

async function loadForManage(req, res) {
  const id = idParam(req.params.id);
  const target = id && (await db.one('SELECT * FROM employees WHERE id = ?', [id]));
  if (!target) { res.status(404).json({ error: 'Employee not found.' }); return null; }
  if (target.role === 'owner' && req.user.role !== 'owner') { res.status(403).json({ error: 'Only an Owner can change an Owner.' }); return null; }
  return target;
}

router.put('/:id', auth.requireRole('owner', 'admin'), async (req, res) => {
  const target = await loadForManage(req, res);
  if (!target) return;
  const { data, errors, ok } = check(req.body, { ...FULL_SPEC, active: { type: 'bool' } });
  if (!ok) return reject(res, errors);
  if (!('active' in (req.body || {}))) data.active = Number(target.active);
  if (data.role === 'owner' && req.user.role !== 'owner') return reject(res, { role: 'Only an Owner can make someone an Owner.' });

  const self = target.id === req.user.id;
  if (self && !data.active) return reject(res, { active: 'You cannot deactivate your own account.' });
  if (self && data.role !== target.role) return reject(res, { role: 'You cannot change your own role.' });
  const losingOwner = target.role === 'owner' && Number(target.active) === 1 && (data.role !== 'owner' || !data.active);
  if (losingOwner && (await activeOwnerCount(target.id)) === 0) return reject(res, { role: 'The firm must keep at least one active Owner.' });

  const dupe = await db.one('SELECT id FROM employees WHERE email = ? AND id <> ?', [data.email, target.id]);
  if (dupe) return reject(res, { email: 'Another employee already uses this email.' });

  // Deactivation, role or email change signs the person out everywhere.
  const signOut = !data.active || data.role !== target.role || data.email !== target.email;
  await db.q(
    `UPDATE employees SET name = ?, email = ?, mobile = ?, designation = ?, role = ?, date_joined = ?, dob = ?, address = ?,
       emergency_name = ?, emergency_phone = ?, active = ?, auth_version = auth_version + ? WHERE id = ?`,
    [data.name, data.email, data.mobile, data.designation, data.role, data.date_joined, data.dob, data.address,
      data.emergency_name, data.emergency_phone, data.active, signOut ? 1 : 0, target.id]
  );
  if (signOut) await db.q('DELETE FROM sessions WHERE employee_id = ?', [target.id]);

  const changes = diff(target, data, Object.keys(FULL_SPEC).concat('active'));
  let action = 'employee.updated';
  if (Number(target.active) === 1 && !data.active) action = 'employee.deactivated';
  if (Number(target.active) === 0 && data.active) action = 'employee.reactivated';
  await audit(req, action, { entity: 'employee', entityId: target.id, summary: `${{ 'employee.updated': 'Updated', 'employee.deactivated': 'Deactivated', 'employee.reactivated': 'Reactivated' }[action]} ${data.name}`, detail: changes });
  res.json({ item: shape(await db.one(`SELECT ${PUBLIC_FIELDS} FROM employees WHERE id = ?`, [target.id])) });
});

router.post('/:id/reset-password', auth.requireRole('owner', 'admin'), async (req, res) => {
  const target = await loadForManage(req, res);
  if (!target) return;
  if (target.id === req.user.id) return res.status(422).json({ error: 'Use "Change password" on your own profile.' });
  const password = auth.tempPassword();
  await db.q(
    'UPDATE employees SET password_hash = ?, must_change_pw = 1, failed_attempts = 0, locked_until = NULL, auth_version = auth_version + 1 WHERE id = ?',
    [await auth.hashPassword(password), target.id]
  );
  await db.q('DELETE FROM sessions WHERE employee_id = ?', [target.id]);
  await audit(req, 'employee.password_reset', { entity: 'employee', entityId: target.id, summary: `Reset password for ${target.name}` });
  res.json({ tempPassword: password });
});

module.exports = router;
