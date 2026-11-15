'use strict';
const express = require('express');
const db = require('../db');
const { audit, diff } = require('../audit');
const { check, reject, idParam } = require('../validate');

const router = express.Router();

const TYPES = ['individual', 'proprietorship', 'partnership', 'llp', 'company', 'trust', 'huf', 'other'];
const SPEC = {
  name: { label: 'Client name', required: true, max: 160 },
  type: { label: 'Type', required: true, oneOf: TYPES },
  pan: { label: 'PAN', format: 'pan', upper: true },
  gstin: { label: 'GSTIN', format: 'gstin', upper: true },
  contact_person: { label: 'Contact person', max: 120 },
  email: { label: 'Email', format: 'email', max: 190, lower: true },
  mobile: { label: 'Mobile', format: 'mobile', max: 20 },
  address: { label: 'Address', max: 500, multiline: true },
  city: { label: 'City', max: 80 },
  state: { label: 'State', max: 60 },
  pincode: { label: 'PIN code', format: 'pincode' },
  notes: { label: 'Notes', max: 4000, multiline: true },
  assigned_to: { label: 'Handled by', type: 'int' },
  active: { type: 'bool' },
};

const SELECT = `SELECT c.id, c.name, c.type, c.pan, c.gstin, c.contact_person, c.email, c.mobile, c.address, c.city,
  c.state, c.pincode, c.notes, c.assigned_to, e.name AS assigned_name, c.active, c.revision, c.created_at, c.updated_at,
  cb.name AS created_by_name
  FROM clients c
  LEFT JOIN employees e ON e.id = c.assigned_to
  LEFT JOIN employees cb ON cb.id = c.created_by`;

const shape = (r) => (r ? { ...r, active: !!Number(r.active), revision: Number(r.revision) } : r);

async function validate(req, res) {
  const { data, errors } = check(req.body, SPEC);
  // PAN is embedded in the GSTIN (characters 3–12): catch typos early.
  if (!errors.pan && !errors.gstin && data.pan && data.gstin && data.gstin.slice(2, 12) !== data.pan) {
    errors.gstin = 'GSTIN does not match the PAN entered.';
  }
  if (!errors.assigned_to && data.assigned_to) {
    const emp = await db.one('SELECT id FROM employees WHERE id = ? AND active = 1', [data.assigned_to]);
    if (!emp) errors.assigned_to = 'Choose an active employee.';
  }
  if (Object.keys(errors).length) { reject(res, errors); return null; }
  return data;
}

async function gstinTaken(gstin, exceptId = 0) {
  if (!gstin) return null;
  return db.one('SELECT id, name FROM clients WHERE gstin = ? AND id <> ?', [gstin, exceptId]);
}

router.get('/', async (req, res) => {
  const where = [];
  const params = [];
  const term = String(req.query.q || '').trim().slice(0, 80);
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    where.push('(c.name LIKE ? OR c.pan LIKE ? OR c.gstin LIKE ? OR c.contact_person LIKE ? OR c.mobile LIKE ? OR c.email LIKE ?)');
    params.push(like, like, like, like, like, like);
  }
  const status = String(req.query.status || 'active');
  if (status === 'active') where.push('c.active = 1');
  else if (status === 'inactive') where.push('c.active = 0');
  if (req.query.mine === '1') { where.push('c.assigned_to = ?'); params.push(req.user.id); }
  if (TYPES.includes(req.query.type)) { where.push('c.type = ?'); params.push(req.query.type); }

  const limit = Math.min(Math.max(Math.floor(Number(req.query.limit)) || 50, 1), 200);
  const offset = Math.min(Math.max(Math.floor(Number(req.query.offset)) || 0, 0), 1000000);
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const [rows, total] = await Promise.all([
    db.q(`${SELECT}${clause} ORDER BY c.name LIMIT ? OFFSET ?`, [...params, limit, offset]),
    db.one(`SELECT COUNT(*) AS n FROM clients c${clause}`, params),
  ]);
  res.json({ items: rows.map(shape), total: Number(total.n), limit, offset });
});

router.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const row = id && (await db.one(`${SELECT} WHERE c.id = ?`, [id]));
  if (!row) return res.status(404).json({ error: 'Client not found.' });
  const history = await db.q(
    "SELECT at, actor_name, action, summary FROM audit_log WHERE entity = 'client' AND entity_id = ? ORDER BY id DESC LIMIT 20",
    [String(id)]
  );
  res.json({ item: shape(row), history });
});

router.post('/', async (req, res) => {
  const data = await validate(req, res);
  if (!data) return;
  const taken = await gstinTaken(data.gstin);
  if (taken) return reject(res, { gstin: `This GSTIN is already saved for ${taken.name}.` });
  const r = await db.q(
    `INSERT INTO clients (name, type, pan, gstin, contact_person, email, mobile, address, city, state, pincode, notes, assigned_to, active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [data.name, data.type, data.pan, data.gstin, data.contact_person, data.email, data.mobile, data.address, data.city,
      data.state, data.pincode, data.notes, data.assigned_to, req.user.id]
  );
  await audit(req, 'client.created', { entity: 'client', entityId: r.insertId, summary: `Added client ${data.name}` });
  res.status(201).json({ item: shape(await db.one(`${SELECT} WHERE c.id = ?`, [r.insertId])) });
});

router.put('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const before = id && (await db.one('SELECT * FROM clients WHERE id = ?', [id]));
  if (!before) return res.status(404).json({ error: 'Client not found.' });
  const revision = Number(req.body?.revision);
  if (!Number.isInteger(revision)) return res.status(422).json({ error: 'Missing revision. Please reload.' });
  const data = await validate(req, res);
  if (!data) return;
  if (!('active' in req.body)) data.active = Number(before.active);
  const taken = await gstinTaken(data.gstin, id);
  if (taken) return reject(res, { gstin: `This GSTIN is already saved for ${taken.name}.` });

  // Optimistic locking: refuse to overwrite someone else's newer save.
  const r = await db.q(
    `UPDATE clients SET name = ?, type = ?, pan = ?, gstin = ?, contact_person = ?, email = ?, mobile = ?, address = ?, city = ?,
       state = ?, pincode = ?, notes = ?, assigned_to = ?, active = ?, revision = revision + 1
     WHERE id = ? AND revision = ?`,
    [data.name, data.type, data.pan, data.gstin, data.contact_person, data.email, data.mobile, data.address, data.city,
      data.state, data.pincode, data.notes, data.assigned_to, data.active, id, revision]
  );
  if (r.affectedRows === 0) {
    return res.status(409).json({ error: 'Someone else changed this client after you opened it. Reload to see the latest details.' });
  }
  const changes = diff(before, data, Object.keys(SPEC));
  let action = 'client.updated';
  if (Number(before.active) === 1 && !data.active) action = 'client.deactivated';
  if (Number(before.active) === 0 && data.active) action = 'client.reactivated';
  await audit(req, action, { entity: 'client', entityId: id, summary: `${action === 'client.updated' ? 'Updated' : action === 'client.deactivated' ? 'Marked inactive' : 'Reactivated'} ${data.name}`, detail: changes });
  res.json({ item: shape(await db.one(`${SELECT} WHERE c.id = ?`, [id])) });
});

module.exports = router;
