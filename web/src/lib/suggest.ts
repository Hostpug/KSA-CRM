import { esc } from './ui';

export const DESIGNATIONS = ['Partner', 'Office Admin', 'Audit Assistant', 'Article Assistant', 'Accountant', 'Tax Consultant'];

/**
 * Styled suggestion dropdown for a text input (replaces <datalist>, which browsers draw
 * outside the sheet and cannot be styled). Free text is still allowed.
 */
export function suggest(input: HTMLInputElement, options: string[] | (() => string[])) {
  const opts = () => (typeof options === 'function' ? options() : options);
  const field = input.closest('.field') as HTMLElement;
  field.classList.add('has-suggest');
  const list = document.createElement('div');
  list.className = 'suggest-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  input.insertAdjacentElement('afterend', list);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-autocomplete', 'list');

  let shown: string[] = [];
  let active = -1;

  const render = () => {
    const q = input.value.trim().toLowerCase();
    shown = opts().filter((o) => !q || o.toLowerCase().includes(q)).slice(0, 30);
    if (shown.length === 1 && shown[0].toLowerCase() === q) shown = [];
    if (!shown.length) { list.hidden = true; return; }
    list.innerHTML = shown.map((o, i) => {
      const at = q ? o.toLowerCase().indexOf(q) : -1;
      const label = at >= 0 ? `${esc(o.slice(0, at))}<mark>${esc(o.slice(at, at + q.length))}</mark>${esc(o.slice(at + q.length))}` : esc(o);
      return `<div class="suggest-opt ${i === active ? 'on' : ''}" role="option" data-i="${i}">${label}</div>`;
    }).join('');
    list.style.top = `${input.offsetTop + input.offsetHeight + 4}px`;
    list.hidden = false;
  };
  const close = () => { list.hidden = true; active = -1; };
  const choose = (i: number) => {
    input.value = shown[i];
    close();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  input.addEventListener('focus', () => { active = -1; render(); });
  input.addEventListener('click', () => { if (list.hidden) render(); });
  input.addEventListener('input', () => { active = -1; render(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (list.hidden) { if (e.key === 'ArrowDown') { render(); e.preventDefault(); } return; }
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, shown.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && active >= 0) { choose(active); e.preventDefault(); }
    else if (e.key === 'Escape') { close(); e.preventDefault(); e.stopPropagation(); }
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    e.preventDefault();
    const opt = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (opt) choose(Number(opt.dataset.i));
  });
}
