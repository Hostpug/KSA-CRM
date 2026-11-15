import { api, setCsrf } from './api';
import { initials, ROLE_LABEL, initSheets } from './ui';
import { suggest, DESIGNATIONS } from './suggest';
import { loadCatalog, servicesFor } from './services';

export type Me = {
  user: { id: number; name: string; email: string; role: 'owner' | 'admin' | 'staff'; designation: string | null; mustChangePassword: boolean };
  csrf: string;
  firm: { name: string; tagline: string };
};

let resolveReady!: (me: Me) => void;
/** Resolves once the signed-in user is known (app pages only). */
export const ready: Promise<Me> = new Promise((r) => { resolveReady = r; });

const CACHE = 'ksa.me';

function paint(me: Me) {
  const { user, firm } = me;
  document.body.dataset.role = user.role;
  document.querySelectorAll<HTMLElement>('[data-show]').forEach((el) => {
    el.hidden = !(el.dataset.show || '').split(' ').includes(user.role);
  });
  document.querySelectorAll('[data-user-name]').forEach((el) => { el.textContent = user.name; });
  document.querySelectorAll('[data-user-role]').forEach((el) => { el.textContent = ROLE_LABEL[user.role] || user.role; });
  document.querySelectorAll('[data-initials]').forEach((el) => { el.textContent = initials(user.name); });
  document.querySelectorAll('[data-firm]').forEach((el) => { el.textContent = firm.name; });
}

async function bootApp() {
  // Paint instantly from the last known user, then confirm with the server.
  try {
    const cached = sessionStorage.getItem(CACHE);
    if (cached) paint(JSON.parse(cached));
  } catch { /* storage unavailable */ }

  let me: Me;
  try {
    me = await api<Me>('/auth/me');
  } catch {
    return; // api() already redirected on 401, or we are offline
  }
  setCsrf(me.csrf);
  try { sessionStorage.setItem(CACHE, JSON.stringify({ ...me, csrf: '' })); } catch { /* ignore */ }

  if (me.user.mustChangePassword && location.pathname !== '/me') {
    location.replace('/me?first=1');
    return;
  }
  const allowed = document.body.dataset.roles;
  if (allowed && !allowed.split(' ').includes(me.user.role)) {
    location.replace('/');
    return;
  }
  paint(me);
  resolveReady(me);
}

function chrome() {
  const bar = document.querySelector('.topbar');
  if (bar) {
    const onScroll = () => bar.classList.toggle('scrolled', window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
  initSheets();
  // Sign out from anywhere (sidebar button, phone account menu, profile page).
  document.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-signout]');
    if (!b || b.disabled) return;
    b.disabled = true;
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* signed out anyway */ }
    clearCachedUser();
    location.replace('/login');
  });
  // Phone account menu
  const meBtn = document.getElementById('meBtn');
  const meMenu = document.getElementById('meMenu');
  if (meBtn && meMenu) {
    const toggle = (open: boolean) => { meMenu.hidden = !open; meBtn.setAttribute('aria-expanded', String(open)); };
    meBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(meMenu.hidden); });
    document.addEventListener('click', (e) => { if (!meMenu.hidden && !meMenu.contains(e.target as Node)) toggle(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !meMenu.hidden) { toggle(false); meBtn.focus(); } });
  }
  // A field's error message goes away as soon as the user starts fixing it.
  document.addEventListener('input', (e) => {
    const f = (e.target as HTMLElement).closest?.('.field.invalid');
    if (!f) return;
    f.classList.remove('invalid');
    f.querySelector('.err')?.remove();
  });
  document.querySelectorAll<HTMLInputElement>('input[data-suggest]').forEach((i) => {
    if (i.dataset.suggest === 'designations') { suggest(i, DESIGNATIONS); return; }
    const cat = () => (i.form?.elements.namedItem('category') as HTMLSelectElement | RadioNodeList | null)?.value || '';
    suggest(i, () => servicesFor(cat()));
  });
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

chrome();
if (document.body.dataset.bare !== '1') {
  bootApp();
  if (document.querySelector('input[data-suggest="services"]')) ready.then(() => loadCatalog());
}

export function clearCachedUser() {
  try { sessionStorage.removeItem(CACHE); } catch { /* ignore */ }
}
