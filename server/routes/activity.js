'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();

// Activity log: Owner & Admin. Cursor pagination by id (newest first).
router.get('/', auth.requireRole('owner', 'admin'), async (req, res) => {
  const where = [];
  const params = [];
  const before = Number(req.query.before);
  if (Number.isInteger(before) && before > 0) { where.push('id < ?'); params.push(before); }
  const entity = String(req.query.entity || '');
  if (['client', 'employee', 'settings'].includes(entity)) { where.push('entity = ?'); params.push(entity); }
  if (req.query.kind === 'auth') where.push("action LIKE 'auth.%'");
  const limit = 40;
  const rows = await db.q(
    `SELECT id, at, actor_id, actor_name, action, entity, entity_id, summary, detail, ip FROM audit_log
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`,
    [...params, limit + 1]
  );
  const more = rows.length > limit;
  const items = rows.slice(0, limit).map((r) => {
    let detail = null;
    try { detail = r.detail ? JSON.parse(r.detail) : null; } catch (_) { detail = null; }
    return { ...r, id: Number(r.id), detail };
  });
  res.json({ items, next: more ? items[items.length - 1].id : null });
});

module.exports = router;
