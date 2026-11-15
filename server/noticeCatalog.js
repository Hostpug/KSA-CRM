'use strict';
// GST and Income-tax notice catalogue + the tracking steps ("movements").
// Reply days are typical defaults only; the date printed on the notice always wins
// and the user can change the due date.

const STAGES = {
  1: 'Received',
  2: 'Waiting on client',
  3: 'Reply in preparation',
  4: 'Reply filed',
  5: 'Hearing',
  6: 'Order received',
  7: 'Appeal / rectification',
  8: 'Closed',
};
const OPEN = [1, 2, 3, 4, 5, 6, 7];

// code, name, section, reply (form / action), days (default time to reply), group
const TYPES = {
  gst: [
    { code: 'ASMT-10', name: 'Scrutiny of return – discrepancies', section: 'Sec 61', reply: 'ASMT-11', days: 30, group: 'Scrutiny & assessment' },
    { code: 'ASMT-14', name: 'Best judgement assessment (unregistered person)', section: 'Sec 63', reply: 'Reply', days: 15, group: 'Scrutiny & assessment' },
    { code: 'ADT-01', name: 'Audit by tax authorities', section: 'Sec 65', reply: 'Produce records', days: 15, group: 'Scrutiny & assessment' },
    { code: 'DRC-01A', name: 'Intimation before show cause notice', section: 'Sec 73 / 74 · Rule 142(1A)', reply: 'DRC-01A Part B', days: 30, group: 'Demand' },
    { code: 'DRC-01', name: 'Show cause notice – tax demand', section: 'Sec 73 / 74 / 74A', reply: 'DRC-06', days: 30, group: 'Demand' },
    { code: 'DRC-01B', name: 'Liability mismatch: GSTR-1 vs GSTR-3B', section: 'Rule 88C', reply: 'DRC-01B Part B', days: 7, group: 'Demand' },
    { code: 'DRC-01C', name: 'ITC mismatch: GSTR-2B vs GSTR-3B', section: 'Rule 88D', reply: 'DRC-01C Part B', days: 7, group: 'Demand' },
    { code: 'DRC-07', name: 'Summary of demand order', section: 'Sec 73 / 74 · Rule 142(5)', reply: 'Appeal APL-01', days: 90, group: 'Demand' },
    { code: 'DRC-09/13', name: 'Recovery proceedings / notice to bank', section: 'Sec 79', reply: 'Reply / pay', days: 7, group: 'Demand' },
    { code: 'GSTR-3A', name: 'Notice to return defaulter', section: 'Sec 46', reply: 'File return', days: 15, group: 'Returns & registration' },
    { code: 'REG-03', name: 'Clarification on registration application', section: 'Rule 9', reply: 'REG-04', days: 7, group: 'Returns & registration' },
    { code: 'REG-17', name: 'Show cause – cancellation of registration', section: 'Sec 29 · Rule 22', reply: 'REG-18', days: 7, group: 'Returns & registration' },
    { code: 'REG-23', name: 'Show cause – rejection of revocation', section: 'Sec 30 · Rule 23', reply: 'REG-24', days: 7, group: 'Returns & registration' },
    { code: 'CMP-05', name: 'Show cause – denial of composition', section: 'Sec 10 · Rule 6', reply: 'CMP-06', days: 15, group: 'Returns & registration' },
    { code: 'RFD-08', name: 'Show cause – rejection of refund', section: 'Sec 54 · Rule 92', reply: 'RFD-09', days: 15, group: 'Refund & others' },
    { code: 'MOV-07', name: 'Detention of goods / e-way bill', section: 'Sec 129', reply: 'Reply / pay', days: 7, group: 'Refund & others' },
    { code: 'GST-OTHER', name: 'Other GST notice / letter', section: '', reply: 'Reply', days: 15, group: 'Refund & others' },
  ],
  it: [
    { code: '143(1)(a)', name: 'Proposed adjustment while processing return', section: 'Sec 143(1)(a)', reply: 'Online response', days: 30, group: 'Return processing' },
    { code: '143(1)', name: 'Intimation – demand / refund after processing', section: 'Sec 143(1)', reply: 'Pay / rectify', days: 30, group: 'Return processing' },
    { code: '139(9)', name: 'Defective return', section: 'Sec 139(9)', reply: 'Corrected return', days: 15, group: 'Return processing' },
    { code: '245', name: 'Refund adjustment against demand', section: 'Sec 245', reply: 'Online response', days: 30, group: 'Return processing' },
    { code: '154', name: 'Rectification of mistake', section: 'Sec 154', reply: 'Reply', days: 15, group: 'Return processing' },
    { code: '142(1)', name: 'Inquiry before assessment', section: 'Sec 142(1)', reply: 'Submission', days: 15, group: 'Assessment' },
    { code: '143(2)', name: 'Scrutiny assessment', section: 'Sec 143(2)', reply: 'Submission', days: 15, group: 'Assessment' },
    { code: '144B-SCN', name: 'Show cause / draft assessment order (faceless)', section: 'Sec 144B / 144', reply: 'Reply', days: 7, group: 'Assessment' },
    { code: '148A', name: 'Show cause before reopening assessment', section: 'Sec 148A', reply: 'Reply', days: 15, group: 'Reassessment & revision' },
    { code: '148', name: 'Reassessment – income escaping assessment', section: 'Sec 148', reply: 'File return', days: 30, group: 'Reassessment & revision' },
    { code: '263', name: 'Revision by Principal Commissioner', section: 'Sec 263', reply: 'Submission', days: 15, group: 'Reassessment & revision' },
    { code: '156', name: 'Demand notice', section: 'Sec 156', reply: 'Pay / appeal', days: 30, group: 'Demand & penalty' },
    { code: '274', name: 'Penalty show cause (e.g. 270A / 271)', section: 'Sec 274', reply: 'Reply', days: 15, group: 'Demand & penalty' },
    { code: '133(6)', name: 'Call for information', section: 'Sec 133(6)', reply: 'Submission', days: 7, group: 'Information & TDS' },
    { code: '131', name: 'Summons', section: 'Sec 131', reply: 'Appear / submit', days: 7, group: 'Information & TDS' },
    { code: 'TDS', name: 'TDS default (200A / 201 / TRACES)', section: 'Sec 200A / 201', reply: 'Correction / pay', days: 30, group: 'Information & TDS' },
    { code: 'IT-OTHER', name: 'Other income tax notice / e-proceeding', section: '', reply: 'Reply', days: 15, group: 'Information & TDS' },
  ],
};

const APPEAL = {
  gst: { label: 'Appeal filed · APL-01', months: 3, hint: 'Appeal to the Appellate Authority within 3 months of the order (APL-01). Rectification under Sec 161 is also possible within 3 months.' },
  it: { label: 'Appeal filed · Form 35 (CIT(A))', days: 30, hint: 'Appeal to CIT(A) in Form 35 within 30 days of the order / demand. Rectification under Sec 154 is also possible.' },
};
const RECTIFY = { gst: 'Rectification sought · Sec 161', it: 'Rectification sought · Sec 154' };

/**
 * Movements that can be recorded. stage: new stage (null = unchanged).
 * ask: extra fields shown. due: default next-action date (days after the event date)
 * or 'reply' (keeps the reply due date) / 'hearing' / 'appeal' / null (clear).
 */
/** What filing the reply means, in words: "file ASMT-11", "file the submission", "pay / rectify". */
function todo(type) {
  const r = type?.reply || 'Reply';
  if (/^[A-Z]{2,4}-\d/.test(r)) return `file ${r}`;
  if (/^(File|Pay|Produce|Appear|Correction|Appeal)/.test(r)) return r.charAt(0).toLowerCase() + r.slice(1);
  return `file the ${r.toLowerCase()}`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function events(tax, type) {
  const reply = type?.reply || 'Reply';
  return [
    { code: 'docs_requested', label: 'Documents requested from client', stage: 2, due: 3, next: 'Follow up with the client for documents' },
    { code: 'docs_received', label: 'Documents received from client', stage: 3, due: 'reply', next: cap(todo(type)) },
    { code: 'extension', label: 'Adjournment / extension sought', stage: null, due: 'ask', ask: ['ref'], next: 'Reply by the extended date' },
    { code: 'reply_filed', label: `Reply filed · ${reply}`, stage: 4, due: 15, ask: ['ref'], next: 'Follow up with the department' },
    { code: 'further_notice', label: 'Further notice / query received', stage: 3, due: 'ask', ask: ['ref'], next: 'Prepare the reply' },
    { code: 'hearing', label: 'Personal hearing scheduled', stage: 5, due: 'hearing', ask: ['hearing_date'], next: 'Attend the hearing' },
    { code: 'hearing_done', label: 'Hearing attended / written submission', stage: 5, due: 15, next: 'Await the order' },
    { code: 'order', label: 'Order received', stage: 6, due: 'appeal', ask: ['ref', 'outcome', 'demand_amount'], next: 'Decide: accept and pay, rectify or appeal' },
    { code: 'paid', label: 'Demand paid', stage: 8, due: null, ask: ['ref'], next: '' },
    { code: 'appeal', label: APPEAL[tax].label, stage: 7, due: 30, ask: ['ref'], next: 'Track the appeal hearing' },
    { code: 'rectification', label: RECTIFY[tax], stage: 7, due: 30, ask: ['ref'], next: 'Follow up on the rectification' },
    { code: 'closed', label: 'Closed · no further action', stage: 8, due: null, ask: ['outcome'], next: '' },
    { code: 'reopen', label: 'Reopen', stage: 3, due: 'ask', next: 'Prepare the reply' },
    { code: 'note', label: 'Note / follow-up call', stage: null, due: 'keep', next: null },
  ];
}

const OUTCOMES = ['Dropped / no demand', 'Accepted (no change)', 'Demand confirmed', 'Demand partly confirmed', 'Registration cancelled', 'Refund rejected', 'Other'];

const typeOf = (tax, code) => (TYPES[tax] || []).find((t) => t.code === code) || null;

module.exports = { STAGES, OPEN, TYPES, APPEAL, OUTCOMES, events, typeOf, todo };
