// Password vault UI shared by the vault page and the client page.
import { api, ApiError } from './api';
import { esc, icon, ago, dateOnly, openSheet, closeSheet, readForm, fillForm, submitting, toast, toastError, showErrors } from './ui';
import { clientPicker } from './clientPicker';
import { todayIST } from './stages';
import { ready } from './boot';

export type VItem = {
  id: number; client_id: number; client_name: string; portal: string; portal_name: string; label: string | null;
  username: string; reg_mobile: string | null; reg_email: string | null; login_url: string; url: string | null;
  changed_on: string | null; revision: number; has_password: boolean; has_notes: boolean; updated_at: string; updated_by_name: string | null;
};

const SHORT: Record<string, string> = { gst: 'GST', it: 'ITR', traces: 'TDS', ewb: 'EWB', einv: 'IRP', mca: 'MCA', epfo: 'PF', esic: 'ESI', pt: 'PT', bank: 'BANK', other: '•••' };
const REVEAL_SECONDS = 30;

// ---------- lock state ----------
type Listener = (unlocked: boolean, seconds: number) => void;
const listeners = new Set<Listener>();
let unlockedUntil = 0;
let tick: number | undefined;
export const isUnlocked = () => Date.now() < unlockedUntil;
export const onLockChange = (fn: Listener) => { listeners.add(fn); fn(isUnlocked(), secondsLeft()); };
const secondsLeft = () => Math.max(0, Math.round((unlockedUntil - Date.now()) / 1000));
function setUnlocked(seconds: number) {
  unlockedUntil = seconds > 0 ? Date.now() + seconds * 1000 : 0;
  clearInterval(tick);
  const emit = () => {
    const s = secondsLeft();
    listeners.forEach((fn) => fn(s > 0, s));
    if (s <= 0) { clearInterval(tick); hideAll(); }
  };
  emit();
  if (seconds > 0) tick = window.setInterval(emit, 1000);
}
export async function refreshLock() {
  try { const s = await api('/vault/status'); setUnlocked(s.unlocked ? s.seconds : 0); } catch { /* ignore */ }
}
export async function lockNow() {
  try { await api('/vault/lock', { method: 'POST' }); } catch { /* ignore */ }
  setUnlocked(0);
  toast('Vault locked');
}

// ---------- unlock sheet ----------
let pendingUnlock: ((ok: boolean) => void) | null = null;
function unlockSheet() { return document.getElementById('vUnlockSheet') as HTMLDialogElement; }
export function ensureUnlocked(): Promise<boolean> {
  if (isUnlocked()) return Promise.resolve(true);
  const form = document.getElementById('vUnlockForm') as HTMLFormElement;
  form.reset();
  openSheet(unlockSheet());
  setTimeout(() => (form.elements.namedItem('password') as HTMLInputElement).focus(), 120);
  return new Promise((resolve) => { pendingUnlock = resolve; });
}

// ---------- reveal / copy ----------
const timers = new Map<number, number>();
function hideAll() {
  document.querySelectorAll<HTMLElement>('[data-pw-of].shown').forEach((el) => { el.textContent = '••••••••'; el.classList.remove('shown'); });
  document.querySelectorAll<HTMLElement>('.vnote').forEach((el) => el.remove());
  document.querySelectorAll<HTMLElement>('[data-eye]').forEach((b) => { b.innerHTML = icon('eye'); b.setAttribute('aria-label', 'Show password'); });
}
async function fetchSecret(id: number, purpose: 'view' | 'copy') {
  if (!(await ensureUnlocked())) return null;
  try {
    return await api(`/vault/${id}/reveal`, { method: 'POST', body: { purpose } });
  } catch (err) {
    if (err instanceof ApiError && err.status === 423) { setUnlocked(0); if (await ensureUnlocked()) return fetchSecret(id, purpose); return null; }
    toastError(err);
    return null;
  }
}
async function toggleReveal(id: number, btn: HTMLElement) {
  const code = document.querySelector<HTMLElement>(`[data-pw-of="${id}"]`)!;
  if (code.classList.contains('shown')) { hide(id); return; }
  const s = await fetchSecret(id, 'view');
  if (!s) return;
  code.textContent = s.password || '(empty)';
  code.classList.add('shown');
  btn.innerHTML = icon('eyeoff');
  btn.setAttribute('aria-label', 'Hide password');
  const row = code.closest('.vmain');
  if (s.notes && row && !row.querySelector('.vnote')) row.insertAdjacentHTML('beforeend', `<div class="vnote">${esc(s.notes)}</div>`);
  clearTimeout(timers.get(id));
  timers.set(id, window.setTimeout(() => hide(id), REVEAL_SECONDS * 1000));
}
function hide(id: number) {
  const code = document.querySelector<HTMLElement>(`[data-pw-of="${id}"]`);
  if (!code) return;
  code.textContent = '••••••••';
  code.classList.remove('shown');
  code.closest('.vmain')?.querySelector('.vnote')?.remove();
  const b = document.querySelector<HTMLElement>(`[data-eye="${id}"]`);
  if (b) { b.innerHTML = icon('eye'); b.setAttribute('aria-label', 'Show password'); }
}
let clearClip: number | undefined;
async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied${what === 'Password' ? ` · clipboard clears in ${REVEAL_SECONDS}s` : ''}`);
    if (what === 'Password') {
      clearTimeout(clearClip);
      clearClip = window.setTimeout(() => { navigator.clipboard.writeText('').catch(() => {}); }, REVEAL_SECONDS * 1000);
    }
  } catch { toast('Copy is blocked by the browser. Select and copy instead.', 'error'); }
}

// ---------- rows ----------
function ageNote(changed: string | null) {
  if (!changed) return '';
  const days = Math.round((Date.parse(todayIST()) - Date.parse(changed.slice(0, 10))) / 86400000);
  const txt = `Changed ${dateOnly(changed)}`;
  return days > 180 ? `<span class="old" title="Over 6 months old">${esc(txt)}</span>` : esc(txt);
}
export function rowsHTML(items: VItem[], { showClient = true, canLog = false } = {}) {
  return items.map((v, i) => `
    <li class="vrow" data-id="${v.id}" data-i="${Math.min(i, 12)}">
      <span class="vportal p-${esc(v.portal)}" title="${esc(v.portal_name)}">${esc(SHORT[v.portal] || v.portal)}</span>
      <div class="vmain">
        <div class="vt">${esc(v.portal_name)}${v.label ? ` <span class="muted">· ${esc(v.label)}</span>` : ''}${showClient ? ` <span class="muted">· <a href="/client?id=${v.client_id}">${esc(v.client_name)}</a></span>` : ''}</div>
        <div class="vcreds">
          <span class="vfield"><span class="k">User ID</span><code>${esc(v.username)}</code>
            <button type="button" class="btn ghost icon" data-copy-user="${v.id}" aria-label="Copy user ID" title="Copy user ID">${icon('copy')}</button></span>
          <span class="vfield"><span class="k">Password</span><code data-pw-of="${v.id}">••••••••</code>
            <button type="button" class="btn ghost icon" data-eye="${v.id}" aria-label="Show password" title="Show">${icon('eye')}</button>
            <button type="button" class="btn ghost icon" data-copy-pw="${v.id}" aria-label="Copy password" title="Copy password">${icon('copy')}</button></span>
        </div>
        <div class="vmeta">
          ${v.login_url ? `<a href="${esc(v.login_url)}" target="_blank" rel="noopener noreferrer">Open portal ↗</a>` : ''}
          ${ageNote(v.changed_on)}
          ${v.reg_mobile ? `<span>Regd. mobile ${esc(v.reg_mobile)}</span>` : ''}
          ${v.reg_email ? `<span>${esc(v.reg_email)}</span>` : ''}
          ${v.has_notes ? '<span>Has notes</span>' : ''}
        </div>
      </div>
      <div class="vact">
        ${canLog ? `<button type="button" class="btn ghost icon" data-log="${v.id}" aria-label="Access log" title="Access log">${icon('activity')}</button>` : ''}
        <button type="button" class="btn ghost icon" data-edit="${v.id}" aria-label="Edit" title="Edit">${icon('edit')}</button>
      </div>
    </li>`).join('');
}

/**
 * Wire the vault sheets once per page. `reload` refreshes whatever list the page shows.
 * Returns helpers to bind a list and open the add form.
 */
export function initVault(reload: () => void, opts: { fixedClient?: () => { id: number; name: string } | null } = {}) {
  // unlock
  const uForm = document.getElementById('vUnlockForm') as HTMLFormElement;
  uForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await submitting(uForm, document.getElementById('vUnlockSave') as HTMLButtonElement, () =>
      api('/vault/unlock', { method: 'POST', body: { password: readForm(uForm).password } }));
    if (!res) return;
    setUnlocked(res.seconds);
    const done = pendingUnlock; pendingUnlock = null;
    closeSheet(unlockSheet());
    toast('Vault unlocked for 10 minutes');
    done?.(true);
  });
  unlockSheet().addEventListener('close', () => { const done = pendingUnlock; pendingUnlock = null; done?.(isUnlocked()); });

  // add / edit
  const sheet = document.getElementById('vEditSheet') as HTMLDialogElement;
  const form = document.getElementById('vEditForm') as HTMLFormElement;
  const picker = clientPicker(document.getElementById('vClientField')!, { newLabel: 'Not a saved client' });
  const pw = form.elements.namedItem('password') as HTMLInputElement;
  const notes = form.elements.namedItem('notes') as HTMLTextAreaElement;
  const loadNotes = document.getElementById('vNotesLoad') as HTMLButtonElement;
  let current: VItem | null = null;
  let notesChanged = false;
  let portals: Record<string, { name: string; url: string }> = {};
  api('/vault/status').then((s) => { portals = s.portals; setUnlocked(s.unlocked ? s.seconds : 0); }).catch(() => {});

  document.getElementById('vPwToggle')!.addEventListener('click', (e) => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    (e.currentTarget as HTMLElement).innerHTML = icon(show ? 'eyeoff' : 'eye');
  });
  pw.addEventListener('input', () => {
    const c = form.elements.namedItem('changed_on') as HTMLInputElement;
    if (pw.value && (!c.value || (current && c.value === (current.changed_on || '').slice(0, 10)))) c.value = todayIST();
  });
  notes.addEventListener('input', () => { notesChanged = true; });
  loadNotes.addEventListener('click', async () => {
    if (!current) return;
    const s = await fetchSecret(current.id, 'view');
    if (!s) return;
    notes.value = s.notes || '';
    notes.disabled = false;
    loadNotes.hidden = true;
    notes.focus();
  });

  function open(item: VItem | null) {
    current = item;
    notesChanged = false;
    form.reset();
    pw.type = 'password';
    (document.getElementById('vPortal') as HTMLSelectElement).innerHTML = Object.entries(portals).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('');
    const fixed = opts.fixedClient?.() || null;
    const clientField = document.getElementById('vClientField')!;
    clientField.hidden = !!fixed && !item;
    if (item) picker.set(item.client_id, item.client_name); else if (fixed) picker.set(fixed.id, fixed.name); else picker.set(null, '');
    if (item) fillForm(form, { ...item, password: '' });
    (document.getElementById('vEditTitle') as HTMLElement).textContent = item ? 'Edit portal login' : 'Add portal login';
    (document.getElementById('vPwHint') as HTMLElement).textContent = item ? 'Leave blank to keep the current password.' : '';
    (form.querySelector('[data-pw-req]') as HTMLElement).hidden = !!item;
    pw.placeholder = item ? '•••••••• (unchanged)' : '';
    notes.disabled = !!item?.has_notes;
    notes.placeholder = item?.has_notes ? 'Saved notes are hidden' : 'Encrypted like the password';
    loadNotes.hidden = !item?.has_notes;
    (document.getElementById('vDelete') as HTMLElement).hidden = !item || !['owner', 'admin'].includes(document.body.dataset.role || '');
    openSheet(sheet);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = readForm(form);
    const { client_id } = picker.get();
    if (!client_id) { showErrors(form, { client_id: 'Choose a saved client.' }); return; }
    if (!current && !v.password) { showErrors(form, { password: 'Enter the password.' }); return; }
    const body: Record<string, any> = { ...v, client_id, notes_changed: !current || notesChanged };
    if (current) body.revision = current.revision;
    if (current && !notesChanged) delete body.notes;
    const res = await submitting(form, document.getElementById('vSave') as HTMLButtonElement, () =>
      api(current ? `/vault/${current.id}` : '/vault', { method: current ? 'PUT' : 'POST', body }));
    if (!res) return;
    closeSheet(sheet);
    toast(current ? 'Login updated' : 'Login saved');
    reload();
  });
  document.getElementById('vDelete')!.addEventListener('click', async () => {
    if (!current || !confirm(`Delete the ${current.portal_name} login of ${current.client_name}? This cannot be undone.`)) return;
    try { await api(`/vault/${current.id}`, { method: 'DELETE' }); closeSheet(sheet); toast('Login deleted'); reload(); } catch (err) { toastError(err); }
  });

  // access log
  async function openLog(item: VItem) {
    const ul = document.getElementById('vLogList')!;
    ul.innerHTML = '<li class="muted">Loading…</li>';
    (document.getElementById('vLogTitle') as HTMLElement).textContent = `Access log · ${item.portal_name}`;
    openSheet(document.getElementById('vLogSheet') as HTMLDialogElement);
    try {
      const d = await api(`/vault/${item.id}/log`);
      ul.innerHTML = d.items.length ? d.items.map((a: any) => `<li><div>${esc(a.summary)}</div><div class="when">${esc(a.actor_name || 'System')} · ${esc(ago(a.at))}${a.ip ? ` · ${esc(a.ip)}` : ''}</div></li>`).join('') : '<li class="muted">No activity yet.</li>';
    } catch (err) { toastError(err); }
  }

  /** Bind clicks inside a list rendered with rowsHTML. */
  function bind(list: HTMLElement, items: () => VItem[]) {
    list.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      const find = (attr: string) => { const b = t.closest<HTMLElement>(`[${attr}]`); return b ? { b, item: items().find((x) => String(x.id) === b.getAttribute(attr))! } : null; };
      let hit;
      if ((hit = find('data-eye'))) { await toggleReveal(hit.item.id, hit.b); return; }
      if ((hit = find('data-copy-pw'))) { const s = await fetchSecret(hit.item.id, 'copy'); if (s) copyText(s.password, 'Password'); return; }
      if ((hit = find('data-copy-user'))) { copyText(hit.item.username, 'User ID'); return; }
      if ((hit = find('data-edit'))) { open(hit.item); return; }
      if ((hit = find('data-log'))) { openLog(hit.item); }
    });
  }

  // Hide everything when the tab is hidden for a while.
  document.addEventListener('visibilitychange', () => { if (document.hidden) hideAll(); });
  ready.then(refreshLock);
  return { open, bind };
}

/** Stagger the rows' entrance (set through the CSSOM; inline styles are blocked by the CSP). */
export function staggerRows(list: HTMLElement) {
  list.querySelectorAll<HTMLElement>('[data-i]').forEach((el) => el.style.setProperty('--i', el.dataset.i!));
}
