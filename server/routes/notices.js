'use strict';
// GST and income tax notice tracker.
const express = require('express');
const db = require('../db');
const { audit, diff } = require('../audit');
const { check, reject, idParam } = require('../validate');
const cat = require('../noticeCatalog');
const { todayIST } = require('../workflow');
const wf = require('../workflow');

const router = express.Router();
const TODAY_IST = 'DATE(UTC_TIMESTAMP() + INTERVAL 330 MINUTE)';
const TAX_LABEL = { gst: 'GST', it: 'Income tax' };

const SPEC = {
  client_id: { label: 'Client', type: 'int' },
  tax_id: { label: 'GSTIN / PAN', max: 15, upper: true },
  type_code: { label: 'Notice type', max: 20 },
  act: { label: 'Act', oneOf: ['1961', '2025'] },
  section: { label: 'Section', max: 60 },
  ref_no: { label: 'Reference / DIN', max: 80 },
  period: { label: 'Period', max: 200 },
  subject: { label: 'Issue / subject', max: 500 },
  authority: { label: 'Department / officer', max: 250 }, // older records; new ones use the three fields below
  officer_name: { label: 'Officer name', max: 120 },
  officer_designation: { label: 'Designation', max: 120 },
  officer_location: { label: 'Location / jurisdiction', max: 160 },
  tax_amount: { label: 'Tax', format: 'money' },
  interest_amount: { label: 'Interest', format: 'money' },
  penalty_amount: { label: 'Penalty', format: 'money' },
  notice_date: { label: 'Notice date', format: 'date' },
  received_date: { label: 'Received on', format: 'date' },
  next_action: { label: 'Next action', max: 250 },
  next_due: { label: 'Next action due', format: 'date' },
  hearing_date: { label: 'Hearing date', format: 'date' },
  assigned_to: { label: 'Assigned to', type: 'int' },
  reviewer_id: { label: 'Reviewer', type: 'int' },
  notes: { label: 'Notes', max: 4000, multiline: true },
};
const FIELDS = Object.keys(SPEC);

const EVENT_SPEC = {
  event: { label: 'Event', max: 30 },
  event_date: { label: 'Date', format: 'date' },
  ref: { label: 'Reference', max: 120 },
  notes: { label: 'Notes', max: 4000, multiline: true },
  next_action: { label: 'Next action', max: 250 },
  next_due: { label: 'Next action due', format: 'date' },
  hearing_date: { label: 'Hearing date', format: 'date' },
  outcome: { label: 'Outcome', max: 120 },
  demand_amount: { label: 'Demand in the order', format: 'money' },
};

const SELECT = `SELECT n.*, c.name AS client_name, c.gstin AS client_gstin, c.pan AS client_pan,
    a.name AS assigned_name, r.name AS reviewer_name, cb.name AS created_by_name,
    (n.stage < 8 AND n.next_due IS NOT NULL AND n.next_due < ${TODAY_IST}) AS overdue,
    DATEDIFF(n.next_due, ${TODAY_IST}) AS days_left,
    (SELECT GROUP_CONCAT(g.so_no ORDER BY l.id SEPARATOR ', ') FROM notice_links l JOIN engagements g ON g.id = l.engagement_id WHERE l.notice_id = n.id) AS so_nos
  FROM notices n
  JOIN clients c ON c.id = n.client_id
  LEFT JOIN employees a ON a.id = n.assigned_to
  LEFT JOIN employees r ON r.id = n.reviewer_id
  LEFT JOIN employees cb ON cb.id = n.created_by`;

function shape(r) {
  if (!r) return r;
  const type = cat.typeOf(r.tax, r.type_code);
  const total = ['tax_amount', 'interest_amount', 'penalty_amount'].reduce((s, k) => s + Math.round(Number(r[k] || 0) * 100), 0);
  return {
    ...r,
    stage: Number(r.stage),
    revision: Number(r.revision),
    overdue: !!Number(r.overdue),
    days_left: r.days_left === null ? null : Number(r.days_left),
    type_name: type ? type.name : r.type_code,
    reply_form: type ? type.reply : 'Reply',
    disputed_total: total ? (total / 100).toFixed(2) : null,
  };
}

class Invalid extends Error {
  constructor(fields, status = 422) { super(Object.values(fields)[0]); this.fields = fields; this.status = status; }
}
function handleError(res, err) {
  if (err instanceof Invalid) return err.status === 409 ? res.status(409).json({ error: err.message }) : reject(res, err.fields);
  throw err;
}

const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const appealDue = (tax, orderDate) => (cat.APPEAL[tax].months ? addMonths(orderDate, cat.APPEAL[tax].months) : addDays(orderDate, cat.APPEAL[tax].days));

async function checkRefs(t, rec, errors) {
  if (!rec.client_id) errors.client_id = 'Choose the client.';
  else {
    const c = await t.one('SELECT id, active FROM clients WHERE id = ?', [rec.client_id]);
    if (!c) errors.client_id = 'Client not found.';
  }
  for (const f of ['assigned_to', 'reviewer_id']) {
    if (rec[f] && !(await t.one('SELECT id FROM employees WHERE id = ? AND active = 1', [rec[f]]))) errors[f] = 'Choose an active team member.';
  }
  if (!rec.type_code || !cat.typeOf(rec.tax, rec.type_code)) errors.type_code = 'Choose the notice type.';
  if (!rec.subject) errors.subject = 'Describe the issue / subject.';
  if (rec.notice_date && rec.received_date && rec.received_date < rec.notice_date) errors.received_date = 'Received on cannot be before the notice date.';
  if (rec.notice_date && rec.notice_date > todayIST()) errors.notice_date = 'Notice date cannot be in the future.';
}

// ---------- catalogue ----------
router.get('/meta', (req, res) => {
  res.json({
    stages: cat.STAGES,
    types: cat.TYPES,
    appeal: cat.APPEAL,
    outcomes: cat.OUTCOMES,
    events: { gst: cat.events('gst', null), it: cat.events('it', null) },
  });
});

// ---------- lists ----------
const taxOf = (q) => (q === 'it' ? 'it' : 'gst');

router.get('/summary', async (req, res) => {
  const tax = taxOf(req.query.tax);
  const r = await db.one(
    `SELECT SUM(stage < 8) AS open,
       SUM(stage < 8 AND next_due IS NOT NULL AND next_due < ${TODAY_IST}) AS overdue,
       SUM(stage < 8 AND next_due BETWEEN ${TODAY_IST} AND ${TODAY_IST} + INTERVAL 7 DAY) AS due7,
       SUM(stage < 8 AND hearing_date BETWEEN ${TODAY_IST} AND ${TODAY_IST} + INTERVAL 14 DAY) AS hearings,
       SUM(stage < 8 AND assigned_to = ?) AS mine,
       SUM(no_charge = 0 AND NOT EXISTS (SELECT 1 FROM notice_links l WHERE l.notice_id = notices.id)) AS unbilled,
       SUM(CASE WHEN stage < 8 THEN COALESCE(tax_amount,0) + COALESCE(interest_amount,0) + COALESCE(penalty_amount,0) ELSE 0 END) AS disputed
     FROM notices WHERE tax = ?`, [req.user.id, tax]);
  res.json(Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [k, k === 'disputed' ? Number(v || 0).toFixed(2) : Number(v || 0)])));
});

router.get('/', async (req, res) => {
  const tax = taxOf(req.query.tax);
  const where = ['n.tax = ?'];
  const params = [tax];
  const view = String(req.query.view || 'open');
  if (view === 'open') where.push('n.stage < 8');
  if (view === 'due') where.push(`n.stage < 8 AND n.next_due <= ${TODAY_IST} + INTERVAL 7 DAY`);
  if (view === 'overdue') where.push(`n.stage < 8 AND n.next_due < ${TODAY_IST}`);
  if (view === 'hearing') where.push(`n.stage < 8 AND n.hearing_date >= ${TODAY_IST}`);
  if (view === 'mine') { where.push('n.stage < 8 AND n.assigned_to = ?'); params.push(req.user.id); }
  if (view === 'closed') where.push('n.stage = 8');
  if (view === 'unbilled') where.push('n.no_charge = 0 AND NOT EXISTS (SELECT 1 FROM notice_links l WHERE l.notice_id = n.id)');
  const clientId = idParam(req.query.client_id);
  if (clientId) { where.push('n.client_id = ?'); params.push(clientId); }
  const term = String(req.query.q || '').trim().slice(0, 80);
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    where.push('(c.name LIKE ? OR n.type_code LIKE ? OR n.ref_no LIKE ? OR n.subject LIKE ? OR n.period LIKE ? OR n.tax_id LIKE ? OR a.name LIKE ? OR n.officer_name LIKE ? OR n.officer_location LIKE ?)');
    params.push(like, like, like, like, like, like, like, like, like);
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const clause = ` WHERE ${where.join(' AND ')}`;
  const order = view === 'closed' ? 'n.closed_on DESC, n.id DESC' : 'n.stage = 8, n.next_due IS NULL, n.next_due, n.id DESC';
  const [rows, total] = await Promise.all([
    db.q(`${SELECT}${clause} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, params),
    db.one(`SELECT COUNT(*) AS n FROM notices n JOIN clients c ON c.id = n.client_id LEFT JOIN employees a ON a.id = n.assigned_to${clause}`, params),
  ]);
  res.json({ items: rows.map(shape), total: Number(total.n), limit, offset });
});

// ---------- one notice ----------
router.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const row = id && (await db.one(`${SELECT} WHERE n.id = ?`, [id]));
  if (!row) return res.status(404).json({ error: 'Notice not found.' });
  const [log, history] = await Promise.all([
    db.q(`SELECT e.*, emp.name AS by_name FROM notice_events e LEFT JOIN employees emp ON emp.id = e.created_by
          WHERE e.notice_id = ? ORDER BY e.event_date DESC, e.id DESC`, [id]),
    db.q("SELECT at, actor_name, action, summary FROM audit_log WHERE entity = 'notice' AND entity_id = ? ORDER BY id DESC LIMIT 20", [String(id)]),
  ]);
  const item = shape(row);
  const billing = await billingOf(id);
  res.json({ item, billing, log, history, events: cat.events(item.tax, cat.typeOf(item.tax, item.type_code)), stages: cat.STAGES, appeal: cat.APPEAL[item.tax] });
});

router.post('/', async (req, res) => {
  const tax = req.body?.tax === 'it' ? 'it' : req.body?.tax === 'gst' ? 'gst' : null;
  if (!tax) return res.status(422).json({ error: 'Choose GST or income tax.' });
  const { data, errors, ok } = check(req.body, SPEC);
  if (!ok) return reject(res, errors);
  if (tax === 'gst') data.act = null;
  let id;
  try {
    id = await db.tx(async (t) => {
      const rec = { ...data, tax };
      const e = {};
      await checkRefs(t, rec, e);
      if (Object.keys(e).length) throw new Invalid(e);
      const type = cat.typeOf(tax, rec.type_code);
      const start = rec.notice_date || rec.received_date || todayIST();
      if (!rec.next_due) rec.next_due = addDays(start, type.days);
      rec.reply_due = rec.next_due;
      if (!rec.next_action) rec.next_action = `Collect documents, then ${cat.todo(type)}`;
      if (!rec.section) rec.section = type.section || null;
      const cols = [...FIELDS, 'reply_due', 'tax', 'stage', 'created_by'];
      const vals = cols.map((c) => (c === 'tax' ? tax : c === 'stage' ? 1 : c === 'created_by' ? req.user.id : rec[c] ?? null));
      const r = await t.q(`INSERT INTO notices (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
      await t.q(
        'INSERT INTO notice_events (notice_id, event, label, event_date, ref, stage_after, next_due, created_by) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
        [r.insertId, 'received', `${rec.type_code} received`, rec.received_date || rec.notice_date || todayIST(), rec.ref_no || null, rec.next_due, req.user.id],
      );
      return r.insertId;
    });
  } catch (err) { return handleError(res, err); }
  const item = shape(await db.one(`${SELECT} WHERE n.id = ?`, [id]));
  await audit(req, 'notice.created', { entity: 'notice', entityId: id, summary: `New ${TAX_LABEL[tax]} notice: ${item.client_name} — ${item.type_code}` });
  res.status(201).json({ item });
});

router.put('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const before = id && (await db.one('SELECT * FROM notices WHERE id = ?', [id]));
  if (!before) return res.status(404).json({ error: 'Notice not found.' });
  if (Number(req.body?.revision) !== Number(before.revision)) {
    return res.status(409).json({ error: 'Someone else saved this notice after you opened it. Reload to see the latest version.' });
  }
  const { data, errors, ok } = check(req.body, SPEC, { partial: true });
  if (!ok) return reject(res, errors);
  if (before.tax === 'gst') delete data.act;
  // Before the reply is filed, the next action due date is the reply deadline.
  if (data.next_due && Number(before.stage) < 4) data.reply_due = data.next_due;
  const rec = { ...before, ...data };
  try {
    await db.tx(async (t) => {
      const e = {};
      await checkRefs(t, rec, e);
      if (Object.keys(e).length) throw new Invalid(e);
      const cols = Object.keys(data);
      if (!cols.length) return;
      const r = await t.q(`UPDATE notices SET ${cols.map((c) => `${c} = ?`).join(', ')}, revision = revision + 1 WHERE id = ? AND revision = ?`,
        [...cols.map((c) => data[c]), id, before.revision]);
      if (!r.affectedRows) throw new Invalid({ revision: 'Someone else saved this notice. Reload.' }, 409);
    });
  } catch (err) { return handleError(res, err); }
  const changes = diff(before, rec, FIELDS);
  if (Object.keys(changes).length) {
    await audit(req, 'notice.updated', { entity: 'notice', entityId: id, summary: `Updated ${TAX_LABEL[before.tax]} notice ${before.type_code}`, detail: changes });
  }
  res.json({ item: shape(await db.one(`${SELECT} WHERE n.id = ?`, [id])) });
});

// ---------- billing: link the notice to sales orders ----------
const PURPOSE = { reply: 'Reply', appeal: 'Appeal', linked: 'Linked' };
const CATEGORY = { gst: 'GST', it: 'Income Tax' };

async function billingOf(noticeId) {
  const rows = await db.q(
    `SELECT l.purpose, g.id, g.so_no, g.service, g.stage, g.fee, g.delivered_on, g.assigned_to, a.name AS assigned_name
       FROM notice_links l JOIN engagements g ON g.id = l.engagement_id LEFT JOIN employees a ON a.id = g.assigned_to
      WHERE l.notice_id = ? ORDER BY l.id`, [noticeId]);
  return rows.map((r) => ({ ...r, stage: Number(r.stage), stage_label: wf.STAGES[r.stage], purpose_label: PURPOSE[r.purpose] || r.purpose }));
}

router.post('/:id/billing', async (req, res) => {
  const id = idParam(req.params.id);
  const n = id && (await db.one('SELECT * FROM notices WHERE id = ?', [id]));
  if (!n) return res.status(404).json({ error: 'Notice not found.' });
  const engagements = require('./engagements');
  const action = String(req.body?.action || '');
  const label = `${TAX_LABEL[n.tax]} notice ${n.type_code}`;
  try {
    if (action === 'create') {
      const purpose = req.body.purpose === 'appeal' ? 'appeal' : 'reply';
      const type = cat.typeOf(n.tax, n.type_code);
      const period = n.period ? ` · ${n.period}` : '';
      const service = String(req.body.service || '').trim() || (purpose === 'appeal'
        ? `Appeal against ${n.type_code} order${period}`
        : `Reply to ${n.type_code} – ${type ? type.name : 'notice'}${period}`).slice(0, 250);
      const item = await engagements.createTask(req, {
        client_id: n.client_id, category: CATEGORY[n.tax], service, fee: req.body.fee ?? '',
        work_date: todayIST(), due_date: purpose === 'appeal' ? (n.appeal_due || '') : (n.reply_due || n.next_due || ''),
        assigned_to: n.assigned_to || '', reviewer_id: n.reviewer_id || '',
        notes: `Linked to ${label}${n.ref_no ? ` (${n.ref_no})` : ''}.`,
      });
      await db.q('INSERT INTO notice_links (notice_id, engagement_id, purpose, created_by) VALUES (?, ?, ?, ?)', [id, item.id, purpose, req.user.id]);
      if (n.no_charge) await db.q('UPDATE notices SET no_charge = 0, no_charge_note = NULL WHERE id = ?', [id]);
      await audit(req, 'notice.billing', { entity: 'notice', entityId: id, summary: `${label}: sales order ${item.so_no} created (${PURPOSE[purpose]})` });
      return res.status(201).json({ billing: await billingOf(id), created: item });
    }
    if (action === 'link') {
      const eid = idParam(req.body.engagement_id);
      const g = eid && (await db.one('SELECT id, client_id, so_no, stage FROM engagements WHERE id = ?', [eid]));
      if (!g) return reject(res, { engagement_id: 'Choose a sales order.' });
      if (Number(g.client_id) !== Number(n.client_id)) return reject(res, { engagement_id: 'That sales order belongs to another client.' });
      if (!g.so_no) return reject(res, { engagement_id: 'Only confirmed sales orders can be linked.' });
      await db.q('INSERT IGNORE INTO notice_links (notice_id, engagement_id, purpose, created_by) VALUES (?, ?, ?, ?)', [id, eid, 'linked', req.user.id]);
      if (n.no_charge) await db.q('UPDATE notices SET no_charge = 0, no_charge_note = NULL WHERE id = ?', [id]);
      await audit(req, 'notice.billing', { entity: 'notice', entityId: id, summary: `${label}: linked to ${g.so_no}` });
      return res.json({ billing: await billingOf(id) });
    }
    if (action === 'unlink') {
      const eid = idParam(req.body.engagement_id);
      const g = eid && (await db.one('SELECT so_no FROM engagements WHERE id = ?', [eid]));
      await db.q('DELETE FROM notice_links WHERE notice_id = ? AND engagement_id = ?', [id, eid]);
      await audit(req, 'notice.billing', { entity: 'notice', entityId: id, summary: `${label}: unlinked ${g ? g.so_no : 'sales order'}` });
      return res.json({ billing: await billingOf(id) });
    }
    if (action === 'no_charge') {
      const on = req.body.on === true || req.body.on === 1 || req.body.on === '1';
      const note = on ? String(req.body.note || '').trim().slice(0, 160) || null : null;
      if (on && (await billingOf(id)).length) return reject(res, { no_charge: 'Unlink the sales orders first.' });
      await db.q('UPDATE notices SET no_charge = ?, no_charge_note = ?, revision = revision + 1 WHERE id = ?', [on ? 1 : 0, note, id]);
      await audit(req, 'notice.billing', { entity: 'notice', entityId: id, summary: `${label}: ${on ? `marked no charge${note ? ` (${note})` : ''}` : 'billing reopened'}` });
      return res.json({ billing: await billingOf(id) });
    }
    if (action === 'deliver') {
      const eid = idParam(req.body.engagement_id);
      if (!eid || !(await db.one('SELECT id FROM notice_links WHERE notice_id = ? AND engagement_id = ?', [id, eid]))) return reject(res, { engagement_id: 'That sales order is not linked to this notice.' });
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.delivered_on || '')) ? req.body.delivered_on : todayIST();
      if (date > todayIST()) return reject(res, { delivered_on: 'The date cannot be in the future.' });
      const item = await engagements.deliverFromNotice(req, eid, date, n.assigned_to);
      return res.json({ billing: await billingOf(id), delivered: item });
    }
  } catch (err) {
    if (err instanceof engagements.Invalid) return err.status === 409 ? res.status(409).json({ error: err.message }) : err.status === 404 ? res.status(404).json({ error: err.message }) : reject(res, err.fields);
    throw err;
  }
  return res.status(422).json({ error: 'Unknown billing action.' });
});

// ---------- record a movement ----------
router.post('/:id/events', async (req, res) => {
  const id = idParam(req.params.id);
  const before = id && (await db.one('SELECT * FROM notices WHERE id = ?', [id]));
  if (!before) return res.status(404).json({ error: 'Notice not found.' });
  if (Number(req.body?.revision) !== Number(before.revision)) {
    return res.status(409).json({ error: 'Someone else updated this notice after you opened it. Reload to see the latest version.' });
  }
  const { data, errors, ok } = check(req.body, EVENT_SPEC);
  if (!ok) return reject(res, errors);
  const type = cat.typeOf(before.tax, before.type_code);
  const ev = cat.events(before.tax, type).find((e) => e.code === data.event);
  if (!ev) return reject(res, { event: 'Choose what happened.' });
  const stage = Number(before.stage);
  if (stage === 8 && !['reopen', 'note', 'appeal', 'rectification'].includes(ev.code)) return reject(res, { event: 'This notice is closed. Reopen it first.' });
  if (stage !== 8 && ev.code === 'reopen') return reject(res, { event: 'This notice is already open.' });
  const e = {};
  const date = data.event_date || todayIST();
  if (date > todayIST()) e.event_date = 'The date cannot be in the future.';
  if (ev.code === 'hearing' && !data.hearing_date) e.hearing_date = 'Enter the hearing date.';
  if (ev.due === 'ask' && !data.next_due) e.next_due = 'Enter the new due date.';
  if (data.next_due && data.next_due < date && ev.code !== 'note') e.next_due = 'The next due date cannot be before the event date.';
  if (Object.keys(e).length) return reject(res, e);

  // Work out the notice's new state.
  const upd = {};
  if (ev.stage !== null) upd.stage = ev.stage;
  const replyDue = before.reply_due ? String(before.reply_due).slice(0, 10) : null;
  let due;
  if (data.next_due) due = data.next_due;
  else if (ev.due === 'keep') due = before.next_due ? String(before.next_due).slice(0, 10) : null;
  else if (ev.due === 'reply') due = replyDue || (before.next_due ? String(before.next_due).slice(0, 10) : null);
  else if (ev.due === 'hearing') due = data.hearing_date;
  else if (ev.due === 'appeal') due = appealDue(before.tax, date);
  else if (typeof ev.due === 'number') {
    due = addDays(date, ev.due);
    // A follow-up before the reply is filed should never run past the reply deadline.
    if (stage < 4 && replyDue && due > replyDue && ev.code === 'docs_requested') due = replyDue;
  } else due = null;
  // A new deadline (extension, further notice, reopening) becomes the reply due date.
  if (ev.due === 'ask' && data.next_due) upd.reply_due = data.next_due;
  if (ev.code !== 'note' || data.next_due) upd.next_due = due;
  if (data.next_action) upd.next_action = data.next_action;
  else if (ev.next !== null) upd.next_action = ev.next || null;
  if (ev.code === 'hearing') upd.hearing_date = data.hearing_date;
  if (ev.code === 'order') {
    upd.order_date = date; upd.outcome = data.outcome; upd.demand_amount = data.demand_amount;
    upd.appeal_due = appealDue(before.tax, date);
  }
  if (ev.code === 'closed' && data.outcome) upd.outcome = data.outcome;
  if (ev.code === 'reply_filed' || ev.code === 'further_notice') upd.hearing_date = before.hearing_date && String(before.hearing_date) < date ? null : before.hearing_date;
  if (upd.stage === 8) upd.closed_on = date;
  if (ev.code === 'reopen') upd.closed_on = null;
  const label = ev.code === 'order' && data.outcome ? `Order received · ${data.outcome}` : ev.label;

  try {
    await db.tx(async (t) => {
      const cols = Object.keys(upd);
      const r = await t.q(`UPDATE notices SET ${cols.map((c) => `${c} = ?`).join(', ')}${cols.length ? ', ' : ''}revision = revision + 1 WHERE id = ? AND revision = ?`,
        [...cols.map((c) => upd[c]), id, before.revision]);
      if (!r.affectedRows) throw new Invalid({ revision: 'Someone else updated this notice. Reload.' }, 409);
      await t.q(
        'INSERT INTO notice_events (notice_id, event, label, event_date, ref, notes, stage_after, next_due, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, ev.code, label, date, data.ref, data.notes, upd.stage ?? stage, upd.next_due === undefined ? null : upd.next_due, req.user.id],
      );
    });
  } catch (err) { return handleError(res, err); }
  await audit(req, 'notice.moved', { entity: 'notice', entityId: id, summary: `${TAX_LABEL[before.tax]} notice ${before.type_code}: ${label}`, detail: { event: ev.code, stage: [cat.STAGES[stage], cat.STAGES[upd.stage ?? stage]] } });
  res.status(201).json({ item: shape(await db.one(`${SELECT} WHERE n.id = ?`, [id])) });
});

module.exports = router;
