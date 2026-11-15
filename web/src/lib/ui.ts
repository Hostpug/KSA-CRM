import { ApiError } from './api';

// ---------- text & dates ----------

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape for HTML text and attribute values. Use for every value put into innerHTML. */
export const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const TZ = 'Asia/Kolkata';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Server DATETIME strings are UTC ("2026-11-14 05:30:00"). */
export function utc(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "14 Nov 2026, 11:05 am" in IST. */
export function dateTime(s: string | null | undefined) {
  const d = utc(s);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
}

/** Date-only values (DOB, joining date) have no time zone: format as written. */
export function dateOnly(s: string | null | undefined) {
  if (!s) return '—';
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return s;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "just now", "5 min ago", "3 h ago", "Yesterday", else the IST date. */
export function ago(s: string | null | undefined) {
  const d = utc(s);
  if (!d) return '—';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 45) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  if (sec < 172800) return 'Yesterday';
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export function initials(name: string) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', staff: 'Staff' };
export const CLIENT_TYPES: Record<string, string> = {
  individual: 'Individual', proprietorship: 'Proprietorship', partnership: 'Partnership firm', llp: 'LLP',
  company: 'Company', trust: 'Trust / Society', huf: 'HUF', other: 'Other',
};

export function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: 'numeric', hour12: false }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// ---------- icons for JS-rendered markup ----------
const ICON: Record<string, string> = {
  chevron: '<path d="m9 6 6 6-6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  clients: '<path d="M3 21V8l6-4 6 4v13"/><path d="M15 21V11h5a1 1 0 0 1 1 1v9"/><path d="M7 10h4M7 14h4M7 18h4"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 20a6.5 6.5 0 0 0-3-5.5"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M17 6l3 3M14 9l2 2"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  landmark: '<path d="M3 21h18M5 21v-9M10 21v-9M14 21v-9M19 21v-9M2 9l10-6 10 6z"/>',
  hearing: '<path d="M14 13 4 21M9 4l9 9M7.5 5.5l9 9M12 2l8 8-3 3-8-8z"/>',
  rupee: '<path d="M6 4h12M6 9h12M14 20 7 13h2a4 4 0 0 0 0-9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  play: '<path d="M7 5v14l11-7z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
};
export const icon = (name: keyof typeof ICON | string, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;

// ---------- toasts ----------

export function toast(message: string, kind: 'ok' | 'error' = 'ok') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${kind === 'error' ? 'error' : ''}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(kind === 'error' ? 'alert' : 'check')}<span>${esc(message)}</span>`;
  host.appendChild(el);
  const remove = () => { el.classList.add('out'); el.addEventListener('animationend', () => el.remove(), { once: true }); };
  setTimeout(remove, kind === 'error' ? 5200 : 3000);
  el.addEventListener('click', remove);
}

export function toastError(err: unknown) {
  toast(err instanceof Error ? err.message : 'Something went wrong.', 'error');
}

// ---------- sheets (native <dialog>) ----------

export function openSheet(d: HTMLDialogElement) {
  d.classList.remove('closing');
  d.showModal();
  const first = d.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), select, textarea');
  if (first && window.matchMedia('(min-width: 720px)').matches) first.focus();
}

export function closeSheet(d: HTMLDialogElement) {
  if (!d.open) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { d.close(); return; }
  d.classList.add('closing');
  d.addEventListener('animationend', () => { d.classList.remove('closing'); d.close(); }, { once: true });
}

/** Wire close buttons, backdrop click and Esc (with exit animation) for every sheet on the page. */
export function initSheets() {
  document.querySelectorAll<HTMLDialogElement>('dialog.sheet').forEach((d) => {
    d.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(d); });
    d.addEventListener('click', (e) => {
      if (e.target === d) closeSheet(d); // backdrop
      const t = (e.target as HTMLElement).closest('[data-close]');
      if (t) closeSheet(d);
    });
  });
}

// ---------- forms ----------

/** Read named controls into a plain object (checkboxes -> boolean). */
export function readForm(form: HTMLFormElement) {
  const out: Record<string, any> = {};
  for (const el of Array.from(form.elements) as HTMLInputElement[]) {
    if (!el.name || el.disabled) continue;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

export function fillForm(form: HTMLFormElement, values: Record<string, any>) {
  for (const el of Array.from(form.elements) as HTMLInputElement[]) {
    if (!el.name || !(el.name in values)) continue;
    const v = values[el.name];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v == null ? '' : String(v).slice(0, el.type === 'date' ? 10 : undefined);
  }
}

export function clearErrors(form: HTMLFormElement) {
  form.querySelectorAll('.field.invalid').forEach((f) => f.classList.remove('invalid'));
  form.querySelectorAll('.field .err').forEach((e) => e.remove());
}

export function showErrors(form: HTMLFormElement, fields: Record<string, string>) {
  clearErrors(form);
  let first: HTMLElement | null = null;
  for (const [name, msg] of Object.entries(fields)) {
    const ctl = form.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`);
    const field = ctl?.closest('.field');
    if (!field) continue;
    field.classList.add('invalid');
    const e = document.createElement('span');
    e.className = 'err';
    e.textContent = msg;
    field.appendChild(e);
    first ||= ctl as HTMLElement;
  }
  first?.focus();
  const box = form.closest('.card, dialog') as HTMLElement | null;
  if (box) { box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); }
}

/**
 * Submit helper: disables the button with a spinner, shows field errors from the API,
 * and toasts anything else.
 */
export async function submitting<T>(form: HTMLFormElement, btn: HTMLButtonElement | null, fn: () => Promise<T>): Promise<T | undefined> {
  clearErrors(form);
  btn?.classList.add('loading');
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && Object.keys(err.fields).length) showErrors(form, err.fields);
    else toastError(err);
    return undefined;
  } finally {
    btn?.classList.remove('loading');
  }
}

// ---------- motion ----------

/** Stagger-reveal the children of a container. */
export function reveal(container: Element | null) {
  if (!container) return;
  Array.from(container.children).forEach((c, i) => {
    const el = c as HTMLElement;
    el.style.setProperty('--i', String(Math.min(i, 12)));
    el.classList.remove('reveal');
    void el.offsetWidth;
    el.classList.add('reveal');
  });
}

/** Count a number up from 0 (eased). */
export function countUp(el: HTMLElement, to: number, ms = 700) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || to === 0) { el.textContent = to.toLocaleString('en-IN'); return; }
  const start = performance.now();
  const step = (t: number) => {
    const p = Math.min((t - start) / ms, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(to * eased).toLocaleString('en-IN');
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Segmented control with a sliding thumb. */
export function segmented(root: HTMLElement, onChange: (value: string) => void) {
  const thumb = document.createElement('span');
  thumb.className = 'thumb';
  root.prepend(thumb);
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-value]'));
  const move = (b: HTMLButtonElement) => {
    thumb.style.left = `${b.offsetLeft}px`;
    thumb.style.width = `${b.offsetWidth}px`;
  };
  buttons.forEach((b) => b.addEventListener('click', () => {
    buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    move(b);
    onChange(b.dataset.value || '');
  }));
  const current = buttons.find((b) => b.getAttribute('aria-pressed') === 'true') || buttons[0];
  requestAnimationFrame(() => move(current));
  window.addEventListener('resize', () => {
    const on = buttons.find((b) => b.getAttribute('aria-pressed') === 'true');
    if (on) move(on);
  });
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms = 250) {
  let t: ReturnType<typeof setTimeout>;
  return (...a: A) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function skeletonRows(n = 5) {
  return Array.from({ length: n }, () => '<div class="skel row"></div>').join('');
}

export function emptyState(iconName: string, title: string, text = '') {
  return `<div class="empty">${icon(iconName)}<b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}</div>`;
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Could not copy. Select and copy manually.', 'error'); }
}
