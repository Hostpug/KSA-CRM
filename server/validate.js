'use strict';

const PATTERNS = {
  email: /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/,
  mobile: /^\+?[0-9][0-9 \-]{6,18}$/,
  pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  gstin: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  pincode: /^[1-9][0-9]{5}$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  money: /^\d{1,11}(\.\d{1,2})?$/,
};

const MESSAGES = {
  email: 'Enter a valid email address.',
  mobile: 'Enter a valid mobile number.',
  pan: 'PAN must look like ABCDE1234F.',
  gstin: 'GSTIN must be 15 characters, e.g. 33ABCDE1234F1Z5.',
  pincode: 'PIN code must be 6 digits.',
  date: 'Enter a valid date.',
  money: 'Enter a valid amount (numbers only, up to 2 decimals, no commas).',
};

function validDate(s) {
  if (!PATTERNS.date.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Validate a request body against a spec.
 * spec: { field: { label, required, max, format, upper, lower, oneOf, type: 'bool'|'int' } }
 * Only fields in the spec are read (no mass assignment). Empty strings become null.
 * partial=true skips fields that are absent from the body (for PATCH-style updates).
 */
function check(body, spec, { partial = false } = {}) {
  const data = {};
  const errors = {};
  const src = body && typeof body === 'object' ? body : {};
  for (const [field, rule] of Object.entries(spec)) {
    if (partial && !(field in src)) continue;
    let v = src[field];
    const label = rule.label || field;

    if (rule.type === 'bool') { data[field] = v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0; continue; }

    if (v === undefined || v === null) v = '';
    if (typeof v === 'number') v = String(v);
    if (typeof v !== 'string') { errors[field] = `${label} is invalid.`; continue; }
    v = rule.multiline ? v.replace(/\r\n/g, '\n').trim() : v.trim().replace(/\s+/g, ' ');
    if (rule.upper) v = v.toUpperCase().replace(/\s/g, '');
    if (rule.lower) v = v.toLowerCase();

    if (v === '') {
      if (rule.required) errors[field] = `${label} is required.`;
      else data[field] = null;
      continue;
    }
    if (rule.max && v.length > rule.max) { errors[field] = `${label} must be ${rule.max} characters or fewer.`; continue; }
    if (rule.oneOf && !rule.oneOf.includes(v)) { errors[field] = `${label} is invalid.`; continue; }
    if (rule.type === 'int') {
      if (!/^\d{1,10}$/.test(v)) { errors[field] = `${label} is invalid.`; continue; }
      data[field] = Number(v);
      continue;
    }
    if (rule.format === 'date') {
      if (!validDate(v)) { errors[field] = MESSAGES.date; continue; }
    } else if (rule.format && !PATTERNS[rule.format].test(v)) {
      errors[field] = MESSAGES[rule.format]; continue;
    }
    data[field] = v;
  }
  return { data, errors, ok: Object.keys(errors).length === 0 };
}

/** Send a 422 with field errors. */
function reject(res, errors) {
  return res.status(422).json({ error: Object.values(errors)[0] || 'Please check the form.', fields: errors });
}

/** Parse a positive integer route param, or null. */
function idParam(v) {
  return /^\d{1,10}$/.test(String(v)) ? Number(v) : null;
}

module.exports = { check, reject, idParam, PATTERNS };
