import { api } from './api';
import { esc, debounce, icon } from './ui';

type Options = {
  /** Badge shown for a typed name that is not a saved client (free-text mode). */
  newLabel?: string;
  /**
   * Explicit "add new client" mode: a typed name only counts once the user clicks
   * "Add … as a new client" in the list. The picker then fires `client-new`.
   */
  allowNew?: boolean;
};

/**
 * Turns a `.picker` block into a client search box:
 *   <div class="field picker"><span>Client</span><input data-pick-input /><input type="hidden" name="client_id" />
 *   <div class="picker-list" hidden></div><span class="hint" data-pick-hint></span></div>
 * Typing searches clients. Choosing one sets client_id and fires `client-picked`.
 */
export function clientPicker(root: HTMLElement, { newLabel = 'New client', allowNew = false }: Options = {}) {
  const input = root.querySelector<HTMLInputElement>('[data-pick-input]')!;
  const hidden = root.querySelector<HTMLInputElement>('input[name="client_id"]')!;
  const list = root.querySelector<HTMLElement>('.picker-list')!;
  const hint = root.querySelector<HTMLElement>('[data-pick-hint]')!;
  let items: any[] = [];
  let active = -1;
  let searched = '';
  let isNew = false;
  let loading = false;

  const setHint = () => {
    if (hidden.value) hint.innerHTML = '<span class="badge green dot">Existing client</span>';
    else if (allowNew && isNew) hint.innerHTML = `<span class="badge amber dot">New client · fill in the details below</span>`;
    else if (!allowNew && input.value.trim()) hint.innerHTML = `<span class="badge amber">${esc(newLabel)}</span>`;
    else hint.textContent = '';
  };

  const close = () => { list.hidden = true; active = -1; };
  // Rows: matching clients, then (allowNew) the "add new" row. `active` runs over both.
  const rowCount = () => items.length + (allowNew && searched ? 1 : 0);
  const render = () => {
    const q = input.value.trim();
    if (!q) { close(); return; }
    if (!allowNew && !items.length) { close(); return; }
    let html = items.map((c, i) => `
      <button type="button" class="picker-opt ${i === active ? 'on' : ''}" data-i="${i}">
        <b>${esc(c.name)}</b><span>${esc([c.gstin || c.pan, c.city].filter(Boolean).join(' · '))}</span>
      </button>`).join('');
    if (allowNew) {
      if (loading && !items.length) html = '<div class="picker-empty"><span class="spin"></span><span>Searching clients…</span></div>';
      else {
        if (!items.length) {
          html = `<div class="picker-empty">
            <span class="pe-ic">${icon('search')}</span>
            <div><b>“${esc(q)}” is not in your client list</b><span>Check the spelling, or add them as a new client.</span></div>
          </div>`;
        }
        html += `<button type="button" class="picker-add ${active === items.length ? 'on' : ''}" data-add>
          <span class="pa-ic">${icon('plus')}</span>
          <span><b>Add “${esc(q)}” as a new client</b><span>Enter GSTIN, PAN and contact details next</span></span>
        </button>`;
      }
    }
    const wasHidden = list.hidden;
    list.innerHTML = html;
    list.hidden = false;
    if (wasHidden || allowNew) list.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const search = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 1) { items = []; searched = ''; close(); return; }
    loading = true;
    try { items = (await api(`/clients?q=${encodeURIComponent(q)}&limit=8`)).items; } catch { items = []; }
    loading = false;
    if (q !== input.value.trim()) return; // a newer search is on its way
    searched = q;
    active = allowNew && !items.length ? 0 : -1;
    render();
  }, 180);

  const choose = (c: any) => {
    input.value = c.name;
    hidden.value = String(c.id);
    isNew = false;
    close();
    setHint();
    root.dispatchEvent(new CustomEvent('client-picked', { detail: c }));
  };
  const addNew = () => {
    hidden.value = '';
    isNew = true;
    input.value = input.value.trim();
    close();
    setHint();
    root.dispatchEvent(new CustomEvent('client-new', { detail: { name: input.value } }));
  };

  input.addEventListener('input', () => {
    const wasNew = isNew;
    hidden.value = '';
    isNew = false;
    setHint();
    if (wasNew) root.dispatchEvent(new CustomEvent('client-cleared'));
    if (allowNew && input.value.trim()) { loading = true; searched = ''; render(); }
    search();
  });
  const reopen = () => { if (list.hidden && input.value.trim() && !hidden.value && !isNew && (items.length || allowNew)) render(); };
  input.addEventListener('focus', reopen);
  input.addEventListener('click', reopen);
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    const n = rowCount();
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, n - 1); render(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); render(); e.preventDefault(); }
    if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      if (active < items.length) choose(items[active]); else if (allowNew) addNew();
    }
    if (e.key === 'Escape') { close(); e.stopPropagation(); e.preventDefault(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-add]')) { addNew(); return; }
    const b = t.closest<HTMLElement>('[data-i]');
    if (b) choose(items[Number(b.dataset.i)]);
  });

  return {
    set(id: number | null, name: string) { hidden.value = id ? String(id) : ''; input.value = name || ''; isNew = false; setHint(); },
    get() { return { client_id: hidden.value ? Number(hidden.value) : null, name: input.value.trim(), isNew }; },
  };
}
