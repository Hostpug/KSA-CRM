'use strict';
const express = require('express');
const db = require('../db');
const { audit, diff } = require('../audit');
const { check, reject, idParam, PATTERNS } = require('../validate');
const wf = require('../workflow');

const router = express.Router();

const SPEC = {
  client_id: { label: 'Client', type: 'int' },
  prospect_name: { label: 'Client / prospect', max: 160 },
  prospect_type: { label: 'Business type', oneOf: ['individual', 'proprietorship', 'partnership', 'llp', 'company', 'trust', 'huf', 'other'] },
  prospect_pan: { label: 'PAN', format: 'pan', upper: true },
  prospect_gstin: { label: 'GSTIN', format: 'gstin', upper: true },
  prospect_person: { label: 'Contact person', max: 120 },
  prospect_mobile: { label: 'Mobile', format: 'mobile', max: 20 },
  prospect_email: { label: 'Email', format: 'email', max: 190, lower: true },
  prospect_city: { label: 'City', max: 80 },
  prospect_state: { label: 'State', max: 60 },
  contact: { label: 'Client contact', max: 250 },
  category: { label: 'Category', max: 40 },
  service: { label: 'Service / assignment', max: 250 },
  fee: { label: 'Agreed fee', format: 'money' },
  estimate_date: { label: 'Estimate date', format: 'date' },
  estimate_valid_until: { label: 'Valid until', format: 'date' },
  estimate_notes: { label: 'Estimate notes', max: 4000, multiline: true },
  so_date: { label: 'Sales order date', format: 'date' },
  work_date: { label: 'Work received on', format: 'date' },
  assigned_to: { label: 'Assigned to', type: 'int' },
  reviewer_id: { label: 'Reviewer', type: 'int' },
  due_date: { label: 'Work due date', format: 'date' },
  pending_info: { label: 'Information awaited', max: 4000, multiline: true },
  delivered_on: { label: 'Delivered on', format: 'date' },
  notes: { label: 'Internal notes', max: 4000, multiline: true },
  close_reason: { label: 'Reason', max: 250 },
};
const FIELDS = Object.keys(SPEC);
const TODAY_IST = "DATE(UTC_TIMESTAMP() + INTERVAL 330 MINUTE)";

const SELECT = `SELECT g.*, c.name AS client_name, c.gstin AS client_gstin, c.pan AS client_pan, c.email AS client_email,
    c.mobile AS client_mobile, c.address AS client_address, c.city AS client_city, c.state AS client_state, c.pincode AS client_pincode,
    a.name AS assigned_name, r.name AS reviewer_name, cb.name AS created_by_name,
    (g.stage BETWEEN 3 AND 7 AND g.due_date IS NOT NULL AND g.due_date < ${TODAY_IST}) AS overdue
  FROM engagements g
  LEFT JOIN clients c ON c.id = g.client_id
  LEFT JOIN employees a ON a.id = g.assigned_to
  LEFT JOIN employees r ON r.id = g.reviewer_id
  LEFT JOIN employees cb ON cb.id = g.created_by`;

function shape(r) {
  if (!r) return r;
  return {
    ...r,
    stage: Number(r.stage),
    revision: Number(r.revision),
    overdue: !!Number(r.overdue),
    display_name: r.client_name || r.prospect_name,
    stage_label: wf.STAGES[r.stage],
  };
}

/** Validate estimate line items: [{ description, amount }], max 20. */
function checkItems(raw) {
  if (raw === undefined) return { items: undefined };
  if (!Array.isArray(raw) || raw.length > 20) return { error: 'Up to 20 estimate lines are allowed.' };
  const items = [];
  for (const [i, it] of raw.entries()) {
    const description = String(it?.description ?? '').trim().replace(/\s+/g, ' ');
    const amount = String(it?.amount ?? '').trim();
    if (!description && !amount) continue;
    if (!description || description.length > 250) return { error: `Line ${i + 1}: enter a description (up to 250 characters).` };
    if (!PATTERNS.money.test(amount)) return { error: `Line ${i + 1}: enter a valid amount.` };
    items.push({ description, amount });
  }
  return { items };
}

const toPaise = (v) => Math.round(Number(v || 0) * 100);
const itemsTotal = (items) => (items.reduce((s, it) => s + toPaise(it.amount), 0) / 100).toFixed(2);

async function checkRefs(t, rec, errors) {
  if (rec.client_id && !errors.client_id) {
    const c = await t.one('SELECT id, active FROM clients WHERE id = ?', [rec.client_id]);
    if (!c) errors.client_id = 'Choose a client from the list.';
  }
  for (const f of ['assigned_to', 'reviewer_id']) {
    if (rec[f] && !errors[f]) {
      const e = await t.one('SELECT id FROM employees WHERE id = ? AND active = 1', [rec[f]]);
      if (!e) errors[f] = 'Choose an active employee.';
    }
  }
}

class Invalid extends Error {
  constructor(fields, status = 422) { super(Object.values(fields)[0]); this.fields = fields; this.status = status; }
}

/**
 * Shared create/update logic inside one transaction.
 * before = existing row (null on create). Returns the saved id.
 */
async function save(t, req, { before, kind, stage, data, items, createClient }) {
  const rec = { ...(before || {}), ...data, kind };
  const errors = {};

  // Optionally create the client from the prospect name (on convert to sales order or new task).
  let createdClient = null;
  if (createClient && !rec.client_id) {
    const name = String(rec.prospect_name || '').trim();
    if (!name) throw new Invalid({ prospect_name: 'Enter the client name to create the client.' });
    // Reuse an existing client with the same GSTIN, PAN or name rather than creating a duplicate.
    const existing =
      (rec.prospect_gstin && await t.one('SELECT id FROM clients WHERE gstin = ? AND active = 1', [rec.prospect_gstin])) ||
      (rec.prospect_pan && await t.one('SELECT id FROM clients WHERE pan = ? AND active = 1', [rec.prospect_pan])) ||
      await t.one('SELECT id FROM clients WHERE name = ? AND active = 1', [name]);
    if (existing) {
      rec.client_id = existing.id;
    } else {
      // The client record starts with everything captured on the lead.
      const r = await t.q(
        `INSERT INTO clients (name, type, pan, gstin, contact_person, mobile, email, city, state, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, rec.prospect_type || 'other', rec.prospect_pan || null, rec.prospect_gstin || null, rec.prospect_person || null,
          rec.prospect_mobile || null, rec.prospect_email || null, rec.prospect_city || null, rec.prospect_state || null, req.user.id],
      );
      rec.client_id = r.insertId;
      createdClient = { id: r.insertId, name };
    }
  }

  await checkRefs(t, rec, errors);
  if (rec.prospect_gstin && rec.prospect_pan && rec.prospect_gstin.slice(2, 12) !== rec.prospect_pan) errors.prospect_pan = 'PAN does not match the GSTIN (characters 3–12).';
  if (rec.delivered_on && rec.work_date && rec.delivered_on < rec.work_date) errors.delivered_on = 'Delivered on cannot be before the work received date.';
  if (rec.so_date && rec.estimate_date && rec.so_date < rec.estimate_date) errors.so_date = 'Sales order date cannot be before the estimate date.';
  if (rec.estimate_valid_until && rec.estimate_date && rec.estimate_valid_until < rec.estimate_date) errors.estimate_valid_until = 'Valid until cannot be before the estimate date.';
  Object.assign(errors, wf.requirements(rec, stage));
  if (Object.keys(errors).length) throw new Invalid(errors);

  // Numbers are issued once, when the stage is first reached.
  if (kind === 'sales' && stage >= 1 && stage <= 10 && !rec.estimate_no) rec.estimate_no = await wf.nextNumber(t, 'EST', rec.estimate_date);
  if (stage >= 2 && stage <= 10 && !rec.so_no) rec.so_no = await wf.nextNumber(t, 'SO', rec.so_date || rec.work_date || wf.todayIST());
  // Agreed fee defaults to the estimate total when the sales order is confirmed.
  if (stage >= 2 && !rec.fee && items && items.length) rec.fee = itemsTotal(items);
  if (stage >= 2 && !rec.fee && before) {
    const sum = await t.one('SELECT SUM(amount) AS s FROM estimate_items WHERE engagement_id = ?', [before.id]);
    if (sum && sum.s) rec.fee = String(sum.s);
  }

  const cols = [...FIELDS, 'estimate_no', 'so_no'];
  let id;
  if (!before) {
    const r = await t.q(
      `INSERT INTO engagements (kind, stage, ${cols.join(', ')}, created_by) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?)`,
      [kind, stage, ...cols.map((c) => rec[c] ?? null), req.user.id]
    );
    id = r.insertId;
  } else {
    const stageChanged = stage !== Number(before.stage);
    const r = await t.q(
      `UPDATE engagements SET stage = ?, ${cols.map((c) => `${c} = ?`).join(', ')}, revision = revision + 1
        ${stageChanged ? ', stage_changed_at = UTC_TIMESTAMP()' : ''}
       WHERE id = ? AND revision = ?`,
      [stage, ...cols.map((c) => rec[c] ?? null), before.id, req.body.revision]
    );
    if (r.affectedRows === 0) throw new Invalid({ revision: 'Someone else saved this engagement after you opened it. Reload to see the latest version.' }, 409);
    id = before.id;
  }

  if (items !== undefined) {
    await t.q('DELETE FROM estimate_items WHERE engagement_id = ?', [id]);
    for (const [i, it] of items.entries()) {
      await t.q('INSERT INTO estimate_items (engagement_id, position, description, amount) VALUES (?, ?, ?, ?)', [id, i + 1, it.description, it.amount]);
    }
  }
  return { id, rec, createdClient };
}

function moveSummary(rec, from, to, names) {
  const label = wf.STAGES[to];
  const who = rec.display || rec.prospect_name || 'engagement';
  if (from === null) return `New ${rec.kind === 'direct' ? 'task' : 'lead'}: ${who} — ${rec.service} (${label})`;
  if (from === to) return `Updated ${who} — ${rec.service}`;
  const extra = to === 2 && rec.so_no ? ` · ${rec.so_no}` : to === 1 && rec.estimate_no ? ` · ${rec.estimate_no}` : to === 4 && names.assigned ? ` to ${names.assigned}` : to === 7 && names.reviewer ? ` · reviewer ${names.reviewer}` : '';
  return `${who}: ${wf.STAGES[from]} → ${label}${extra}`;
}

async function names(rec) {
  const out = {};
  if (rec.assigned_to) out.assigned = (await db.one('SELECT name FROM employees WHERE id = ?', [rec.assigned_to]))?.name;
  if (rec.reviewer_id) out.reviewer = (await db.one('SELECT name FROM employees WHERE id = ?', [rec.reviewer_id]))?.name;
  if (rec.client_id) rec.display = (await db.one('SELECT name FROM clients WHERE id = ?', [rec.client_id]))?.name;
  return out;
}

function handleError(res, err) {
  if (err instanceof Invalid) {
    if (err.status === 409) return res.status(409).json({ error: err.message });
    return reject(res, err.fields);
  }
  throw err;
}

// ---------- routes ----------

router.get('/summary', async (req, res) => {
  const row = await db.one(
    `SELECT
       SUM(stage IN (0,1)) AS leads,
       SUM(stage BETWEEN 2 AND 7) AS active,
       SUM(stage BETWEEN 3 AND 7 AND due_date IS NOT NULL AND due_date < ${TODAY_IST}) AS overdue,
       SUM(stage = 8) AS delivered,
       SUM(stage BETWEEN 3 AND 7 AND assigned_to = ?) AS mine,
       SUM(stage = 7 AND reviewer_id = ?) AS to_review
     FROM engagements`,
    [req.user.id, req.user.id]
  );
  const n = (v) => Number(v || 0);
  res.json({ leads: n(row.leads), active: n(row.active), overdue: n(row.overdue), delivered: n(row.delivered), mine: n(row.mine), toReview: n(row.to_review) });
});

router.get('/', async (req, res) => {
  const where = [];
  const params = [];
  const view = String(req.query.view || 'all');
  const views = {
    leads: 'g.stage IN (0,1)',
    closed: 'g.stage = 11',
    active: 'g.stage BETWEEN 2 AND 7',
    delivered: 'g.stage = 8',
    overdue: `g.stage BETWEEN 3 AND 7 AND g.due_date IS NOT NULL AND g.due_date < ${TODAY_IST}`,
    work: 'g.stage BETWEEN 2 AND 10',
    allleads: 'g.stage IN (0,1,11)',
  };
  if (views[view]) where.push(views[view]);
  if (view === 'mine') { where.push('g.stage BETWEEN 3 AND 7 AND (g.assigned_to = ? OR (g.stage = 7 AND g.reviewer_id = ?))'); params.push(req.user.id, req.user.id); }
  if (req.query.stage !== undefined && /^\d{1,2}$/.test(String(req.query.stage)) && wf.STAGES[req.query.stage]) {
    where.push('g.stage = ?'); params.push(Number(req.query.stage));
  }
  const clientId = idParam(req.query.client_id);
  if (clientId) { where.push('g.client_id = ?'); params.push(clientId); }
  const term = String(req.query.q || '').trim().slice(0, 80);
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    where.push('(c.name LIKE ? OR g.prospect_name LIKE ? OR g.service LIKE ? OR g.category LIKE ? OR g.so_no LIKE ? OR g.estimate_no LIKE ? OR a.name LIKE ?)');
    params.push(like, like, like, like, like, like, like);
  }
  const category = String(req.query.category || '').trim().slice(0, 40);
  if (category) { where.push('g.category = ?'); params.push(category); }
  const limit = Math.min(Math.max(Math.floor(Number(req.query.limit)) || 50, 1), 200);
  const offset = Math.min(Math.max(Math.floor(Number(req.query.offset)) || 0, 0), 1000000);
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const order = ['active', 'overdue', 'mine'].includes(view)
    ? 'ORDER BY g.due_date IS NULL, g.due_date, g.updated_at DESC'
    : 'ORDER BY g.updated_at DESC';
  const [rows, total] = await Promise.all([
    db.q(`${SELECT}${clause} ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]),
    db.one(`SELECT COUNT(*) AS n FROM engagements g LEFT JOIN clients c ON c.id = g.client_id LEFT JOIN employees a ON a.id = g.assigned_to${clause}`, params),
  ]);
  res.json({ items: rows.map(shape), total: Number(total.n), limit, offset });
});

/** When each stage was (last) reached, from the audit trail: { stageNumber: at }. */
function reachedAt(kind, moves) {
  const byLabel = Object.fromEntries(Object.entries(wf.STAGES).map(([n, l]) => [l, Number(n)]));
  const out = {};
  for (const m of moves) {
    let d = null; try { d = JSON.parse(m.detail); } catch (_) { /* ignore */ }
    if (!d || !Array.isArray(d.stage)) continue;
    const to = typeof d.stage[1] === 'number' ? d.stage[1] : byLabel[d.stage[1]];
    if (to === undefined) continue;
    if (m.action === 'engagement.created') {
      // Stages passed through on creation (e.g. a task created already allotted).
      for (let s = kind === 'direct' ? 3 : 0; s <= to; s++) out[s] = m.at;
    } else out[to] = m.at;
  }
  return out;
}

router.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const row = id && (await db.one(`${SELECT} WHERE g.id = ?`, [id]));
  if (!row) return res.status(404).json({ error: 'Engagement not found.' });
  const [items, history, firm, moves] = await Promise.all([
    db.q('SELECT description, amount FROM estimate_items WHERE engagement_id = ? ORDER BY position', [id]),
    db.q("SELECT at, actor_name, action, summary, detail FROM audit_log WHERE entity = 'engagement' AND entity_id = ? ORDER BY id DESC LIMIT 30", [String(id)]),
    db.q("SELECT at, action, detail FROM audit_log WHERE entity = 'engagement' AND entity_id = ? AND action IN ('engagement.created', 'engagement.moved') ORDER BY id", [String(id)]),
    db.q("SELECT k, v FROM settings WHERE k LIKE 'firm\\_%'"),
  ]);
  const item = shape(row);
  item.next = (wf.NEXT[item.stage] || []).filter((to) => wf.canMove(item.kind, item.stage, to));
  res.json({
    item,
    items,
    total: itemsTotal(items),
    history: history.map((h) => { let detail = null; try { detail = h.detail ? JSON.parse(h.detail) : null; } catch (_) { /* ignore */ } return { ...h, detail }; }),
    firm: Object.fromEntries(firm.map((f) => [f.k, f.v])),
    stages: wf.STAGES,
    reached: reachedAt(row.kind, moves),
    notices: await db.q(
      `SELECT n.id, n.tax, n.type_code, n.subject, n.period, n.stage, n.next_due, n.next_action, l.purpose
         FROM notice_links l JOIN notices n ON n.id = l.notice_id WHERE l.engagement_id = ? ORDER BY l.id`, [id]),
  });
});

router.post('/', async (req, res) => {
  const kind = req.body?.kind === 'direct' ? 'direct' : 'sales';
  const stage = Number(req.body?.stage ?? (kind === 'direct' ? 3 : 0));
  // A new task starts as received, or allotted when someone is assigned up front.
  const allowed = kind === 'direct' ? [3, 4] : [0, 1];
  if (!allowed.includes(stage)) return res.status(422).json({ error: 'Select an available workflow stage.' });
  const { data, errors, ok } = check(req.body, SPEC);
  if (!ok) return reject(res, errors);
  const { items, error } = checkItems(req.body.items);
  if (error) return reject(res, { items: error });
  if (kind === 'direct') { data.estimate_date = null; data.estimate_valid_until = null; data.estimate_notes = null; data.so_date = null; }

  let result;
  try {
    result = await db.tx((t) => save(t, req, { before: null, kind, stage, data, items: kind === 'sales' ? items : undefined, createClient: !!req.body.create_client }));
  } catch (err) { return handleError(res, err); }

  const n = await names(result.rec);
  if (result.createdClient) await audit(req, 'client.created', { entity: 'client', entityId: result.createdClient.id, summary: `Added client ${result.createdClient.name}` });
  await audit(req, 'engagement.created', { entity: 'engagement', entityId: result.id, summary: moveSummary(result.rec, null, stage, n), detail: { stage: [null, stage] } });
  const item = shape(await db.one(`${SELECT} WHERE g.id = ?`, [result.id]));
  res.status(201).json({ item });
});

/**
 * Create a direct task (sales order) from other modules, e.g. a notice.
 * Same validation, numbering and audit as POST /. Returns the shaped item.
 */
async function createTask(req, body) {
  const stage = body.assigned_to ? 4 : 3;
  const { data, errors, ok } = check(body, SPEC);
  if (!ok) throw new Invalid(errors);
  data.estimate_date = null; data.estimate_valid_until = null; data.estimate_notes = null; data.so_date = null;
  const result = await db.tx((t) => save(t, req, { before: null, kind: 'direct', stage, data, items: undefined, createClient: false }));
  const n = await names(result.rec);
  await audit(req, 'engagement.created', { entity: 'engagement', entityId: result.id, summary: moveSummary(result.rec, null, stage, n), detail: { stage: [null, stage] } });
  return shape(await db.one(`${SELECT} WHERE g.id = ?`, [result.id]));
}

/**
 * Mark a task delivered because the linked notice is done (reply filed / order / closed).
 * The notice tracker is where the work happened, so the SO may jump straight from any
 * work stage (3–7) to "Completed and delivered".
 */
async function deliverFromNotice(req, id, deliveredOn, fallbackAssignee) {
  const before = await db.one('SELECT * FROM engagements WHERE id = ?', [id]);
  if (!before) throw new Invalid({ engagement_id: 'Sales order not found.' }, 404);
  const from = Number(before.stage);
  if (from < 3 || from > 7) throw new Invalid({ engagement_id: `This sales order is already "${wf.STAGES[from]}".` });
  const assigned = before.assigned_to || fallbackAssignee || req.user.id;
  const r = await db.q('UPDATE engagements SET stage = 8, delivered_on = ?, assigned_to = ?, stage_changed_at = UTC_TIMESTAMP(), revision = revision + 1 WHERE id = ? AND revision = ?',
    [deliveredOn, assigned, id, before.revision]);
  if (!r.affectedRows) throw new Invalid({ engagement_id: 'Someone else updated this sales order. Reload.' }, 409);
  const rec = { ...before, stage: 8, delivered_on: deliveredOn, assigned_to: assigned };
  const n = await names(rec);
  await audit(req, 'engagement.moved', {
    entity: 'engagement', entityId: id, summary: `${moveSummary(rec, from, 8, n)} (notice completed)`,
    detail: { stage: [wf.STAGES[from], wf.STAGES[8]], delivered_on: [before.delivered_on, deliveredOn] },
  });
  return shape(await db.one(`${SELECT} WHERE g.id = ?`, [id]));
}

router.put('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const before = id && (await db.one('SELECT * FROM engagements WHERE id = ?', [id]));
  if (!before) return res.status(404).json({ error: 'Engagement not found.' });
  if (!Number.isInteger(req.body?.revision)) return res.status(422).json({ error: 'Missing revision. Please reload.' });
  if (Number(req.body.revision) !== Number(before.revision)) {
    return res.status(409).json({ error: 'Someone else saved this engagement after you opened it. Reload to see the latest version.' });
  }
  const from = Number(before.stage);
  const to = req.body.stage === undefined ? from : Number(req.body.stage);
  if (!Number.isInteger(to) || !wf.canMove(before.kind, from, to)) {
    return res.status(422).json({ error: `Cannot move from "${wf.STAGES[from]}" to "${wf.STAGES[to] || to}".` });
  }
  const { data, errors, ok } = check(req.body, SPEC, { partial: true });
  if (!ok) return reject(res, errors);
  if (before.kind === 'direct') for (const f of ['estimate_date', 'estimate_valid_until', 'estimate_notes', 'so_date']) delete data[f];
  // Estimate lines can only change while the engagement is still a lead.
  let items;
  if (req.body.items !== undefined) {
    if (before.kind === 'direct' || !wf.LEAD_STAGES.includes(from)) return res.status(422).json({ error: 'Estimate lines are locked once the sales order is confirmed.' });
    const r = checkItems(req.body.items);
    if (r.error) return reject(res, { items: r.error });
    items = r.items;
  }

  let result;
  try {
    result = await db.tx((t) => save(t, req, { before, kind: before.kind, stage: to, data, items, createClient: !!req.body.create_client }));
  } catch (err) { return handleError(res, err); }

  const n = await names(result.rec);
  if (result.createdClient) await audit(req, 'client.created', { entity: 'client', entityId: result.createdClient.id, summary: `Added client ${result.createdClient.name}` });
  const changes = diff(before, result.rec, [...FIELDS, 'so_no', 'estimate_no']);
  if (from !== to) changes.stage = [wf.STAGES[from], wf.STAGES[to]];
  if (items !== undefined) changes.items = ['', `${items.length} line(s), total ₹${itemsTotal(items)}`];
  await audit(req, from === to ? 'engagement.updated' : 'engagement.moved', {
    entity: 'engagement', entityId: id, summary: moveSummary(result.rec, from, to, n), detail: changes,
  });
  const item = shape(await db.one(`${SELECT} WHERE g.id = ?`, [id]));
  item.next = (wf.NEXT[item.stage] || []).filter((s) => wf.canMove(item.kind, item.stage, s));
  res.json({ item });
});

module.exports = router;
module.exports.createTask = createTask;
module.exports.deliverFromNotice = deliverFromNotice;
module.exports.Invalid = Invalid;
