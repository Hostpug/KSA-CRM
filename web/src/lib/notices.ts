import { api } from './api';
import { esc } from './ui';
import { todayIST } from './stages';

export type Tax = 'gst' | 'it';
export type NType = { code: string; name: string; section: string; reply: string; days: number; group: string };
export type NEvent = { code: string; label: string; stage: number | null; due: number | string | null; ask?: string[]; next: string | null };
export type Meta = {
  stages: Record<string, string>;
  types: Record<Tax, NType[]>;
  appeal: Record<Tax, { label: string; hint: string }>;
  outcomes: string[];
  events: Record<Tax, NEvent[]>;
};

let meta: Promise<Meta> | null = null;
export const loadMeta = () => (meta ||= api('/notices/meta') as Promise<Meta>);

export const TAX = {
  gst: { label: 'GST', title: 'GST notices', list: '/gst-notices', idLabel: 'GSTIN', idKey: 'client_gstin', period: 'Financial year(s)', periodPh: 'e.g. 2022-23', locationPh: 'e.g. Range II, Chennai North Division' },
  it: { label: 'Income tax', title: 'Income tax notices', list: '/it-notices', idLabel: 'PAN', idKey: 'client_pan', period: 'Assessment year(s)', periodPh: 'e.g. AY 2024-25', locationPh: 'e.g. Ward 2(1), Chennai / NFAC, Delhi' },
} as const;

export const NSTAGES: Record<number, string> = {
  1: 'Received', 2: 'Waiting on client', 3: 'Reply in preparation', 4: 'Reply filed',
  5: 'Hearing', 6: 'Order received', 7: 'Appeal / rectification', 8: 'Closed',
};
const STAGE_TONE: Record<number, string> = { 1: 'blue', 2: 'amber', 3: 'blue', 4: 'green', 5: 'violet', 6: 'amber', 7: 'violet', 8: '' };
export const noticeBadge = (stage: number) => `<span class="badge stage ${STAGE_TONE[stage] ?? ''}">${esc(NSTAGES[stage] || '')}</span>`;

/** "3 days overdue" / "Due today" / "in 5 days", with a tone class. */
export function dueInfo(n: { next_due?: string | null; days_left?: number | null; stage: number }) {
  if (n.stage === 8 || !n.next_due) return { text: '', tone: '' };
  const d = n.days_left ?? Math.round((Date.parse(n.next_due.slice(0, 10)) - Date.parse(todayIST())) / 86400000);
  if (d < 0) return { text: `${-d} day${d === -1 ? '' : 's'} overdue`, tone: 'red' };
  if (d === 0) return { text: 'Due today', tone: 'red' };
  if (d === 1) return { text: 'Due tomorrow', tone: 'amber' };
  if (d <= 3) return { text: `in ${d} days`, tone: 'amber' };
  return { text: `in ${d} days`, tone: '' };
}

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

/** Common officer designations (suggestions only; any text is allowed). */
export const DESIGNATIONS: Record<Tax, string[]> = {
  gst: [
    'Superintendent', 'Inspector', 'Assistant Commissioner', 'Deputy Commissioner', 'Joint Commissioner',
    'Additional Commissioner', 'Commissioner', 'Commissioner (Appeals)', 'State Tax Officer', 'Deputy State Tax Officer',
    'Assistant State Tax Officer', 'Proper Officer',
  ],
  it: [
    'Assessing Officer', 'Income Tax Officer (ITO)', 'Assistant Commissioner (ACIT)', 'Deputy Commissioner (DCIT)',
    'Joint Commissioner (JCIT)', 'Additional Commissioner (Addl. CIT)', 'Commissioner (CIT)', 'Principal Commissioner (PCIT)',
    'CIT (Appeals)', 'Faceless Assessment Unit (NFAC)', 'TDS Officer', 'Inspector',
  ],
};

/** "R. Kumar, Superintendent · Range II, Chennai North" (falls back to the old single field). */
export function officerLine(n: any) {
  const who = [n.officer_name, n.officer_designation].filter(Boolean).join(', ');
  return [who, n.officer_location].filter(Boolean).join(' · ') || n.authority || '';
}
