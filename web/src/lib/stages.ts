// Mirrors server/workflow.js (labels + allowed moves). Server is the authority.
export const STAGES: Record<number, string> = {
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

/** Badge colour per stage. */
export function stageClass(stage: number) {
  if (stage <= 1) return 'blue';
  if (stage === 6) return 'amber';
  if (stage === 7) return 'violet';
  if (stage === 11) return '';
  if (stage >= 8) return 'green solid';
  return 'green';
}

export const stageBadge = (stage: number, label?: string) =>
  `<span class="badge stage ${stageClass(stage)}">${label || STAGES[stage]}</span>`;

/**
 * A move to another stage.
 *  fields: always asked (e.g. the delivery date)
 *  need:   required for the new stage, asked only if not filled in yet
 *  opt:    optional, offered only if not filled in yet
 * A move with nothing to ask happens in one tap.
 */
export type Action = {
  to: number; label: string; tone?: 'primary' | 'danger' | '';
  fields: string[]; need?: string[]; opt?: string[]; hint?: string; createClient?: boolean;
};

export function actionsFor(from: number, next: number[], g: any = {}): Action[] {
  const review = g.reviewer_name ? `Send to ${g.reviewer_name} for review` : 'Send for review';
  const all: Record<string, Action> = {
    '0-1': { to: 1, label: 'Mark estimate sent', tone: 'primary', fields: ['estimate_date', 'estimate_valid_until'], hint: 'An estimate number is issued when you save.' },
    '1-2': { to: 2, label: 'Convert to sales order', tone: 'primary', fields: ['client_pick', 'so_date', 'fee'], hint: 'A sales order number like SO/2026-27/0001 is issued. Mention it in the invoice notes.', createClient: true },
    '1-0': { to: 0, label: 'Back to new lead', fields: [] },
    '0-11': { to: 11, label: 'Mark lost', tone: 'danger', fields: ['close_reason'] },
    '1-11': { to: 11, label: 'Mark lost', tone: 'danger', fields: ['close_reason'] },
    '11-0': { to: 0, label: 'Reopen lead', tone: 'primary', fields: [] },
    '2-3': { to: 3, label: 'Work received', tone: 'primary', fields: ['work_date'], opt: ['due_date'], hint: 'Record the day the client gave the data / documents.' },
    '3-4': { to: 4, label: g.assigned_name ? `Allot to ${g.assigned_name}` : 'Allot work', tone: 'primary', fields: [], need: ['assigned_to'], opt: ['due_date'] },
    '4-5': { to: 5, label: 'Start work', tone: 'primary', fields: [] },
    '5-6': { to: 6, label: 'Waiting for client data', fields: ['pending_info'] },
    '5-7': { to: 7, label: review, tone: 'primary', fields: [], need: ['reviewer_id'] },
    '6-7': { to: 7, label: review, fields: [], need: ['reviewer_id'] },
    '6-5': { to: 5, label: 'Data received · resume work', tone: 'primary', fields: [] },
    '7-8': { to: 8, label: 'Approve & mark delivered', tone: 'primary', fields: ['delivered_on'], hint: 'Billing (Zoho Books) follows in the next phase.' },
    '7-5': { to: 5, label: 'Send back for changes', tone: 'danger', fields: ['notes'], hint: 'Add the review comments to the internal notes.' },
  };
  return next.map((to) => all[`${from}-${to}`]).filter(Boolean) as Action[];
}

/** Fields an action will ask for, given what the engagement already has. */
export function fieldsToAsk(a: Action, g: any) {
  const empty = (f: string) => (f === 'client_pick' ? !g.client_id : g[f] === null || g[f] === undefined || g[f] === '');
  return [...new Set([...a.fields, ...(a.need || []).filter(empty), ...(a.opt || []).filter(empty)])];
}

const shortDate = (d: string) => {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
};

/** Days from today (IST) to a YYYY-MM-DD date: "in 3 days", "today", "2 days overdue". */
export function dueIn(date: string | null | undefined) {
  if (!date) return '';
  const d = Math.round((Date.parse(date.slice(0, 10)) - Date.parse(todayIST())) / 86400000);
  if (d === 0) return 'due today';
  if (d === 1) return 'due tomorrow';
  if (d > 1) return `in ${d} days`;
  return `${-d} day${d === -1 ? '' : 's'} overdue`;
}

/** What happens next, in plain words, for the panel under the progress bar. */
export function nextStep(g: any): { icon: string; title: string; text: string; tone?: 'wait' | 'done' | 'closed' } {
  const who = g.assigned_name || 'The assignee';
  const due = g.due_date ? ` Due ${shortDate(g.due_date)} (${dueIn(g.due_date)}).` : '';
  switch (g.stage) {
    case 0: return { icon: 'edit', title: 'Prepare the estimate', text: 'Add the fee lines in the estimate below, print or share it, then mark it sent.' };
    case 1: return { icon: 'clock', title: 'Waiting for the client to accept', text: `Estimate ${g.estimate_no || ''} was sent${g.estimate_valid_until ? ` and is valid until ${shortDate(g.estimate_valid_until)}` : ''}. Convert it to a sales order once they agree.`, tone: 'wait' };
    case 2: return { icon: 'clock', title: "Waiting for the client's documents", text: 'Record the day the data or documents arrive to start the work.', tone: 'wait' };
    case 3: return g.assigned_name
      ? { icon: 'user', title: 'Confirm the allotment', text: `${g.assigned_name} is set to handle this.${due}` }
      : { icon: 'user', title: 'Allot this work', text: `Choose who will handle it.${due}` };
    case 4: return { icon: 'play', title: 'Ready to start', text: `Allotted to ${who}.${due}` };
    case 5: return { icon: 'activity', title: 'Work in progress', text: `${who} is working on it.${due} Send it for review when it is done.` };
    case 6: return { icon: 'clock', title: 'Waiting on the client', text: g.pending_info ? `Awaiting: ${g.pending_info}` : 'Waiting for information from the client.', tone: 'wait' };
    case 7: return { icon: 'check', title: 'Pending review', text: `${g.reviewer_name || 'The reviewer'} checks the work, then approves it for delivery or sends it back.` };
    case 8: return { icon: 'check', title: 'Delivered', text: `Delivered${g.delivered_on ? ` on ${shortDate(g.delivered_on)}` : ''}. Ready to bill: invoicing through Zoho Books comes with the Billing phase.`, tone: 'done' };
    case 9: return { icon: 'clock', title: 'Billed', text: 'Waiting for the payment.', tone: 'wait' };
    case 10: return { icon: 'check', title: 'Paid', text: 'All done.', tone: 'done' };
    default: return { icon: 'info', title: 'Lead closed', text: `${g.close_reason ? `${g.close_reason}. ` : ''}Reopen it if the client comes back.`, tone: 'closed' };
  }
}

/** Progress steps for the stepper. */
export function steps(kind: 'sales' | 'direct') {
  const work = [
    { key: [3], label: 'Received' },
    { key: [4], label: 'Allotted' },
    { key: [5, 6], label: 'In progress' },
    { key: [7], label: 'Review' },
    { key: [8], label: 'Delivered' },
    { key: [9], label: 'Billed' },
    { key: [10], label: 'Paid' },
  ];
  return kind === 'direct'
    ? work
    : [{ key: [0], label: 'Lead' }, { key: [1], label: 'Estimate' }, { key: [2], label: 'Sales order' }, ...work];
}

export const rupees = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 }) : '—';
};

/** Today in IST as YYYY-MM-DD (for date defaults). */
export const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
