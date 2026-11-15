'use strict';
// Engagement workflow, carried over from the client's "KSA Practice Desk" (stage IDs kept the same).
// Stages 9 (Billed) and 10 (Received) are reached through billing (Phase 3), not by hand.

const STAGES = {
  0: 'New lead',
  1: 'Estimate sent',
  2: 'Sales order confirmed',
  3: 'Work received',
  4: 'Work allotted',
  5: 'Started',
  6: 'Data pending with client',
  7: 'Completed · pending review',
  8: 'Completed and delivered',
  9: 'Billed',
  10: 'Received',
  11: 'Lead closed',
};

// Allowed manual moves (besides staying on the same stage).
const NEXT = {
  0: [1, 11],
  1: [2, 11, 0],
  2: [3],
  3: [4],
  4: [5],
  5: [6, 7],
  6: [7, 5],
  7: [8, 5],
  8: [],
  9: [],
  10: [],
  11: [0],
};

const LEAD_STAGES = [0, 1, 11];

/** Fields a record must have before it can sit at `stage`. Returns { field: message }. */
function requirements(rec, stage) {
  const e = {};
  const need = (f, label) => { if (rec[f] === null || rec[f] === undefined || rec[f] === '') e[f] = `${label} is required at this stage.`; };
  need('service', 'Service / assignment');
  if (rec.kind === 'sales' && stage <= 1) {
    if (!rec.client_id && !rec.prospect_name) e.prospect_name = 'Client or prospect name is required.';
  }
  if (stage === 11) return e;
  const sales = rec.kind === 'sales';
  if (sales && stage >= 1 && stage <= 10) need('estimate_date', 'Estimate date');
  if (stage >= 2 && stage <= 10) {
    if (!rec.client_id) e.client_id = 'Link this engagement to a client.';
    if (sales) need('so_date', 'Sales order date');
  }
  if (stage >= 3 && stage <= 10) need('work_date', 'Work received on');
  if (stage >= 4 && stage <= 10) need('assigned_to', 'Assigned to');
  if (stage === 6) need('pending_info', 'Information awaited from client');
  if (stage === 7) need('reviewer_id', 'Reviewer');
  if (stage >= 8 && stage <= 10) need('delivered_on', 'Delivered on');
  return e;
}

function canMove(kind, from, to) {
  if (from === to) return true;
  if (kind === 'direct' && (to <= 2 || to === 11)) return false;
  return (NEXT[from] || []).includes(to);
}

/** Indian financial year for a YYYY-MM-DD date, e.g. "2026-27". */
function financialYear(isoDate) {
  const [y, m] = isoDate.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Today's date in IST (YYYY-MM-DD). */
function todayIST() {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Next number in a per-financial-year series, e.g. SO/2026-27/0001.
 * Must run inside a transaction (`t` = tx helpers) so the counter row stays locked.
 */
async function nextNumber(t, prefix, isoDate) {
  const fy = financialYear(isoDate);
  const name = `${prefix}-${fy}`;
  await t.q('INSERT INTO counters (name, value) VALUES (?, 1) ON DUPLICATE KEY UPDATE value = value + 1', [name]);
  const row = await t.one('SELECT value FROM counters WHERE name = ?', [name]);
  return `${prefix}/${fy}/${String(row.value).padStart(4, '0')}`;
}

module.exports = { STAGES, NEXT, LEAD_STAGES, requirements, canMove, financialYear, todayIST, nextNumber };
