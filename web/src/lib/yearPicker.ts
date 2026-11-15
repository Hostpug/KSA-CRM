import { esc, icon } from './ui';
import { todayIST } from './stages';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fyLabel = (start: number) => `${start}-${String((start + 1) % 100).padStart(2, '0')}`;

/**
 * Years to choose from, newest first.
 * GST: financial years since GST began (2017-18) up to the current FY.
 * Income tax: assessment years from next AY back 12 years (reopening can go back 10).
 */
export function yearOptions(tax: 'gst' | 'it') {
  const [y, m] = todayIST().split('-').map(Number);
  const fy = m >= 4 ? y : y - 1;
  const out: { value: string; hint: string }[] = [];
  if (tax === 'gst') {
    for (let s = fy; s >= 2017; s--) out.push({ value: fyLabel(s), hint: s === 2017 ? 'Jul 2017 – Mar 2018' : `Apr ${s} – Mar ${s + 1}` });
  } else {
    for (let s = fy + 1; s >= fy - 11; s--) out.push({ value: `AY ${fyLabel(s)}`, hint: `FY ${fyLabel(s - 1)}${s === fy + 1 ? ' · current year' : ''}` });
  }
  return out;
}

/**
 * Multi-select year dropdown. Put it on a `.field` that holds `<input type="hidden" name="period">`.
 * The value is stored as "2021-22, 2022-23" (oldest first).
 */
export function yearPicker(field: HTMLElement, tax: 'gst' | 'it') {
  const hidden = field.querySelector<HTMLInputElement>('input[name="period"]')!;
  const opts = yearOptions(tax);
  const wrap = document.createElement('div');
  wrap.className = 'ndd ydd';
  wrap.innerHTML = `
    <button type="button" class="ndd-btn" aria-haspopup="listbox" aria-expanded="false"><span class="ndd-val"></span>${icon('chevron')}</button>
    <div class="ndd-pop" hidden>
      <div class="ndd-list ydd-list" role="listbox" aria-multiselectable="true" aria-label="${tax === 'gst' ? 'Financial years' : 'Assessment years'}"></div>
      <div class="ydd-foot"><button type="button" class="btn ghost" data-clear>Clear</button><span class="ydd-count"></span><button type="button" class="btn primary" data-done>Done</button></div>
    </div>`;
  hidden.insertAdjacentElement('beforebegin', wrap);
  const btn = wrap.querySelector<HTMLButtonElement>('.ndd-btn')!;
  const pop = wrap.querySelector<HTMLElement>('.ndd-pop')!;
  const list = wrap.querySelector<HTMLElement>('.ydd-list')!;
  const count = wrap.querySelector<HTMLElement>('.ydd-count')!;
  let selected = new Set<string>();

  const ordered = () => [...selected].sort((a, b) => {
    const ia = opts.findIndex((o) => o.value === a);
    const ib = opts.findIndex((o) => o.value === b);
    if (ia < 0 || ib < 0) return ia < 0 ? 1 : -1; // free text from older records goes last
    return ib - ia; // oldest first
  });

  function renderBtn() {
    const vals = ordered();
    const v = wrap.querySelector('.ndd-val')!;
    if (!vals.length) { v.innerHTML = `<span class="ph">Choose ${tax === 'gst' ? 'financial' : 'assessment'} year(s)</span>`; return; }
    const shown = vals.length > 4 ? vals.slice(0, 3) : vals;
    v.innerHTML = shown.map((y) => `<span class="ychip">${esc(y)}</span>`).join('') + (vals.length > shown.length ? `<span class="ychip more">+${vals.length - shown.length}</span>` : '');
  }
  function renderList() {
    const extra = [...selected].filter((s) => !opts.some((o) => o.value === s)).map((s) => ({ value: s, hint: 'From an earlier entry' }));
    list.innerHTML = [...extra, ...opts].map((o) => {
      const on = selected.has(o.value);
      return `<button type="button" class="ndd-opt yopt" role="option" aria-selected="${on}" data-y="${esc(o.value)}">
        <span class="ycheck">${on ? icon('check') : ''}</span><b>${esc(o.value)}</b><small>${esc(o.hint)}</small></button>`;
    }).join('');
    count.textContent = selected.size ? `${selected.size} selected` : '';
  }
  function sync(notify = true) {
    hidden.value = ordered().join(', ');
    renderBtn();
    if (notify) hidden.dispatchEvent(new Event('input', { bubbles: true }));
    field.classList.remove('invalid');
    field.querySelector('.err')?.remove();
  }
  function open() {
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    renderList();
    // Bring the whole list (and its Done button) into view above the sticky footer.
    pop.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    (list.querySelector<HTMLElement>('[aria-selected="true"]') || list.querySelector<HTMLElement>('.yopt'))?.focus({ preventScroll: true });
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  function close(focusBtn = false) {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focusBtn) btn.focus();
  }

  btn.addEventListener('click', () => (pop.hidden ? open() : close()));
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && pop.hidden) { e.preventDefault(); open(); } });
  list.addEventListener('click', (e) => {
    const o = (e.target as HTMLElement).closest<HTMLElement>('[data-y]');
    if (!o) return;
    const y = o.dataset.y!;
    if (selected.has(y)) selected.delete(y); else selected.add(y);
    sync();
    o.setAttribute('aria-selected', String(selected.has(y)));
    o.querySelector('.ycheck')!.innerHTML = selected.has(y) ? icon('check') : '';
    count.textContent = selected.size ? `${selected.size} selected` : '';
  });
  pop.addEventListener('keydown', (e) => {
    const items = Array.from(list.querySelectorAll<HTMLElement>('.yopt'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(i - 1, 0)]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
  });
  wrap.querySelector('[data-clear]')!.addEventListener('click', () => { selected.clear(); sync(); renderList(); });
  wrap.querySelector('[data-done]')!.addEventListener('click', () => close(true));
  // composedPath: the clicked tick may already have been redrawn (detached) by the time this runs.
  document.addEventListener('click', (e) => { if (!pop.hidden && !e.composedPath().includes(wrap)) close(); });

  sync(false);
  return {
    set(value: string | null | undefined) {
      selected = new Set(String(value || '').split(',').map((s) => s.trim()).filter(Boolean));
      sync(false);
    },
  };
}
