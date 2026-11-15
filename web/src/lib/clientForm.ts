import { api } from './api';
import { esc } from './ui';

// GST state codes (first two digits of a GSTIN).
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

let employeesCache: Promise<any[]> | null = null;

/** Fill "Handled by" dropdowns with active employees. */
export async function loadEmployeeOptions(form: HTMLFormElement) {
  employeesCache ||= api('/employees/options').then((d) => d.items).catch(() => []);
  const items = await employeesCache;
  form.querySelectorAll<HTMLSelectElement>('select[data-employees]').forEach((sel) => {
    const keep = sel.value;
    const blank = sel.options[0]?.value === '' ? sel.options[0].textContent : '— Not assigned —';
    sel.innerHTML = `<option value="">${esc(blank)}</option>` +
      items.map((e) => `<option value="${e.id}">${esc(e.name)}${e.designation ? ` · ${esc(e.designation)}` : ''}</option>`).join('');
    sel.value = keep;
  });
}

/** Upper-case PAN/GSTIN as typed; fill PAN and state from a GSTIN. */
export function wireClientForm(form: HTMLFormElement) {
  const pan = form.elements.namedItem('pan') as HTMLInputElement;
  const gstin = form.elements.namedItem('gstin') as HTMLInputElement;
  const state = form.elements.namedItem('state') as HTMLSelectElement;
  const hint = form.querySelector('[data-gst-hint]') as HTMLElement;
  const upper = (el: HTMLInputElement) => el.addEventListener('input', () => {
    const pos = el.selectionStart;
    el.value = el.value.toUpperCase().replace(/\s/g, '');
    if (pos !== null) el.setSelectionRange(pos, pos);
  });
  upper(pan);
  upper(gstin);
  gstin.addEventListener('input', () => {
    const v = gstin.value;
    hint.textContent = '';
    if (v.length >= 2 && GST_STATES[v.slice(0, 2)]) {
      hint.textContent = GST_STATES[v.slice(0, 2)];
      if (!state.value) state.value = GST_STATES[v.slice(0, 2)];
    }
    if (v.length === 15 && !pan.value) pan.value = v.slice(2, 12);
  });
}
