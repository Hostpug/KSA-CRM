import { api } from './api';
import { openSheet, closeSheet, readForm, fillForm, submitting, showErrors, toast, toastError } from './ui';
import { clientPicker } from './clientPicker';
import { loadEmployeeOptions } from './clientForm';
import { todayIST, fieldsToAsk, type Action } from './stages';
import { loadCatalog, categoryOptions } from './services';

// ---------- Edit / stage action ----------

const EDIT_FIELDS = {
  lead: ['client_pick', 'prospect', 'category', 'service', 'contact', 'fee', 'estimate_date', 'estimate_valid_until', 'notes', 'close_reason'],
  work: ['category', 'service', 'contact', 'fee', 'so_date', 'work_date', 'assigned_to', 'due_date', 'reviewer_id', 'pending_info', 'delivered_on', 'notes'],
};

export function initEngagementSheet(onSaved: (item: any) => void) {
  const sheet = document.getElementById('engSheet') as HTMLDialogElement;
  const form = document.getElementById('engForm') as HTMLFormElement;
  const picker = clientPicker(form.querySelector('[data-picker]') as HTMLElement, { newLabel: 'New client will be created' });
  const hint = document.getElementById('engHint') as HTMLElement;
  let current: any = null;
  let action: Action | null = null;
  let shown: string[] = [];

  function show(fields: string[]) {
    shown = fields;
    form.querySelectorAll<HTMLElement>('[data-f]').forEach((el) => { el.hidden = !fields.includes(el.dataset.f!); });
  }

  async function prepare(eng: any) {
    current = eng;
    form.reset();
    await Promise.all([loadEmployeeOptions(form), loadCatalog()]);
    form.querySelectorAll<HTMLSelectElement>('select[data-categories]').forEach((s) => { s.innerHTML = categoryOptions(eng.category); });
    fillForm(form, eng);
    picker.set(eng.client_id, eng.client_name || eng.prospect_name || '');
  }

  async function openEdit(eng: any) {
    await prepare(eng);
    action = null;
    const lead = [0, 1, 11].includes(eng.stage) && eng.kind === 'sales';
    let fields = lead ? EDIT_FIELDS.lead : EDIT_FIELDS.work;
    if (eng.kind === 'direct') fields = fields.filter((f) => f !== 'so_date');
    if (eng.stage !== 11) fields = fields.filter((f) => f !== 'close_reason');
    if (eng.client_id) fields = fields.filter((f) => f !== 'prospect');
    if (eng.stage !== 6) fields = fields.filter((f) => f !== 'pending_info' || eng.pending_info);
    show(fields);
    (document.getElementById('engTitle') as HTMLElement).textContent = 'Edit details';
    (document.getElementById('engSave') as HTMLElement).textContent = 'Save';
    (document.getElementById('engSave') as HTMLElement).classList.remove('danger');
    hint.hidden = true;
    openSheet(sheet);
  }

  /** Moving with no extra fields saves straight away; returns true if a sheet was opened. */
  async function openAction(eng: any, a: Action, total?: string) {
    await prepare(eng);
    action = a;
    const ask = fieldsToAsk(a, eng);
    const defaults: Record<string, string> = {};
    for (const f of ['estimate_date', 'so_date', 'work_date', 'delivered_on']) if (ask.includes(f) && !eng[f]) defaults[f] = todayIST();
    // The approved estimate total becomes the agreed fee (still editable).
    if (ask.includes('fee') && total && Number(total) > 0) defaults.fee = total;
    fillForm(form, defaults);
    if (!ask.length) { shown = []; await submit(); return false; }
    show(ask);
    (document.getElementById('engTitle') as HTMLElement).textContent = a.label;
    const btn = document.getElementById('engSave') as HTMLButtonElement;
    btn.textContent = a.label;
    btn.classList.toggle('danger', a.tone === 'danger');
    hint.hidden = !a.hint;
    (hint.querySelector('span') as HTMLElement).textContent = a.hint || '';
    openSheet(sheet);
    return true;
  }

  async function submit() {
    const v = readForm(form);
    const body: Record<string, any> = { revision: current.revision, stage: action ? action.to : current.stage };
    for (const f of shown) {
      if (f === 'client_pick') {
        const { client_id, name } = picker.get();
        body.client_id = client_id ?? '';
        if (!client_id) { body.prospect_name = name; if (action?.createClient) body.create_client = true; }
        else if (current.kind === 'sales' && action?.to !== 2) body.prospect_name = current.prospect_name || name;
      } else if (f === 'prospect') {
        for (const k of ['prospect_type', 'prospect_pan', 'prospect_gstin', 'prospect_person', 'prospect_mobile', 'prospect_email', 'prospect_city', 'prospect_state']) body[k] = v[k];
      } else body[f] = v[f];
    }
    const call = () => api(`/engagements/${current.id}`, { method: 'PUT', body });
    let res: any;
    if (sheet.open) {
      res = await submitting(form, document.getElementById('engSave') as HTMLButtonElement, call);
    } else {
      // One-tap moves (no fields): show any problem as a toast.
      try { res = await call(); } catch (err) { toastError(err); return; }
    }
    if (!res) return;
    closeSheet(sheet);
    toast(action ? `${action.label} · done` : 'Saved');
    onSaved(res.item);
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  return { openEdit, openAction };
}
