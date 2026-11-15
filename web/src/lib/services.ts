import { api } from './api';

export type Category = { name: string; services: string[] };

let cache: Category[] = [];
let pending: Promise<Category[]> | null = null;

/** The firm's service catalogue (GST, Income Tax, …), fetched once per page. */
export function loadCatalog(force = false): Promise<Category[]> {
  if (force) pending = null;
  pending ||= api('/settings/services')
    .then((d) => (cache = d.categories as Category[]))
    .catch(() => cache);
  return pending;
}

export const catalog = () => cache;

/** Services for one category, or all of them (for suggestions) when none is chosen. */
export function servicesFor(category?: string | null): string[] {
  const c = category && cache.find((x) => x.name === category);
  return c ? c.services : cache.flatMap((x) => x.services);
}

/** Which category a service name belongs to, if any. */
export const categoryOf = (service: string) => cache.find((c) => c.services.includes(service))?.name || '';

/** <option>s for a category <select>, keeping a value that is no longer in the list. */
export function categoryOptions(current?: string | null) {
  const names = cache.map((c) => c.name);
  if (current && !names.includes(current)) names.push(current);
  const esc = (s: string) => s.replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]!));
  return `<option value="">— Choose —</option>${names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}`;
}
