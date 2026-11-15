let csrf = '';
export function setCsrf(token: string) { csrf = token; }

export class ApiError extends Error {
  status: number;
  fields: Record<string, string>;
  code?: string;
  constructor(message: string, status: number, fields: Record<string, string> = {}, code?: string) {
    super(message);
    this.status = status;
    this.fields = fields;
    this.code = code;
  }
}

type Opts = { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; quiet401?: boolean };

/** JSON call to the CRM API with CSRF header and friendly errors. */
export async function api<T = any>(path: string, { method = 'GET', body, quiet401 = false }: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('You appear to be offline. Check the connection and try again.', 0);
  }

  let data: any = {};
  try { data = await res.json(); } catch { /* empty body */ }

  if (res.status === 401 && !quiet401) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`/login?next=${next}`);
  }
  if (res.status === 403 && data.code === 'MUST_CHANGE_PASSWORD' && !location.pathname.startsWith('/me')) {
    location.replace('/me?first=1');
  }
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status}).`, res.status, data.fields || {}, data.code);
  return data as T;
}
