'use strict';
// Service catalogue: categories (GST, Income Tax, …) each holding its services.
// Stored as JSON in settings.service_catalog; the Owner edits it in Settings.
const db = require('./db');

const KEY = 'service_catalog';

const DEFAULT = [
  { name: 'GST', services: [
    'GST registration', 'GST returns (monthly)', 'GST returns (quarterly · QRMP)', 'GST annual return (GSTR-9 / 9C)',
    'GST reconciliation', 'GST notice reply', 'GST refund', 'GST cancellation / revocation', 'E-way bill / e-invoice setup',
  ] },
  { name: 'Income Tax', services: [
    'Income tax return · individual', 'Income tax return · business', 'Income tax notice reply', 'Advance tax computation',
    'TDS returns', 'TDS / TCS notice reply', 'Form 15CA / 15CB', 'PAN / TAN application',
  ] },
  { name: 'Incorporation', services: [
    'Private limited company', 'LLP registration', 'Partnership firm registration', 'Proprietorship setup',
    'MSME / Udyam registration', 'Section 8 company / trust', 'ROC annual filing', 'Director KYC / changes',
  ] },
  { name: 'Certificates', services: [
    'Net worth certificate', 'Turnover certificate', 'Fund utilisation certificate', 'Visa / loan financials',
    'Project report / CMA', 'Other CA certificate',
  ] },
  { name: 'Tax Audit', services: ['Tax audit (Sec 44AB)', 'Statutory audit', 'Stock audit', 'Internal audit', 'GST audit'] },
];

const clean = (s, max) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/** Validate an edited catalogue. Returns { catalog } or { error }. */
function validate(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 20) return { error: 'Keep between 1 and 20 categories.' };
  const seen = new Set();
  const catalog = [];
  for (const c of raw) {
    const name = clean(c?.name, 40);
    if (!name) return { error: 'Every category needs a name.' };
    if (seen.has(name.toLowerCase())) return { error: `"${name}" is listed twice.` };
    seen.add(name.toLowerCase());
    const list = Array.isArray(c?.services) ? c.services : [];
    if (list.length > 60) return { error: `${name}: up to 60 services.` };
    const services = [...new Set(list.map((s) => clean(s, 120)).filter(Boolean))];
    catalog.push({ name, services });
  }
  return { catalog };
}

async function get() {
  const row = await db.one('SELECT v FROM settings WHERE k = ?', [KEY]);
  if (row?.v) {
    try { const r = validate(JSON.parse(row.v)); if (r.catalog) return r.catalog; } catch (_) { /* fall back */ }
  }
  return DEFAULT;
}

async function save(catalog) {
  await db.q('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [KEY, JSON.stringify(catalog)]);
}

module.exports = { get, save, validate, DEFAULT };
