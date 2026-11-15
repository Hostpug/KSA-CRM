'use strict';
const db = require('./db');

/**
 * Record who did what. Never throws: a failed audit write must not break the action,
 * but it is logged to the server console.
 */
async function audit(req, action, { entity = null, entityId = null, summary = null, detail = null } = {}) {
  try {
    await db.q(
      `INSERT INTO audit_log (actor_id, actor_name, action, entity, entity_id, summary, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user ? req.user.id : null,
        req.user ? req.user.name : null,
        action,
        entity,
        entityId == null ? null : String(entityId),
        summary ? String(summary).slice(0, 255) : null,
        detail == null ? null : JSON.stringify(detail).slice(0, 8000),
        req.ip || null,
      ]
    );
  } catch (err) {
    console.error('[audit] write failed:', err.message);
  }
}

/** Field-level diff for update audits: { field: [before, after] }. */
function diff(before, after, fields) {
  const out = {};
  for (const f of fields) {
    const a = before[f] == null ? null : before[f];
    const b = after[f] == null ? null : after[f];
    if (String(a) !== String(b)) out[f] = [a, b];
  }
  return out;
}

module.exports = { audit, diff };
