'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { audit } = require('../audit');
const { check, reject } = require('../validate');
const services = require('../services');

const router = express.Router();

const SPEC = {
  firm_name: { label: 'Firm name', required: true, max: 120 },
  firm_tagline: { label: 'Tagline', max: 120 },
  firm_email: { label: 'Firm email', format: 'email', max: 190, lower: true },
  firm_phone: { label: 'Firm phone', format: 'mobile', max: 20 },
  firm_address: { label: 'Firm address', max: 500, multiline: true },
  firm_gstin: { label: 'Firm GSTIN', format: 'gstin', upper: true },
};
const KEYS = Object.keys(SPEC);

// Service catalogue: everyone needs it to create work; only the Owner edits it.
router.get('/services', async (req, res) => {
  res.json({ categories: await services.get() });
});

router.put('/services', auth.requireRole('owner'), async (req, res) => {
  const { catalog, error } = services.validate(req.body?.categories);
  if (error) return res.status(422).json({ error });
  const before = await services.get();
  await services.save(catalog);
  const count = (c) => c.reduce((n, x) => n + x.services.length, 0);
  await audit(req, 'settings.services', {
    entity: 'settings', summary: `Updated service list (${catalog.length} categories, ${count(catalog)} services)`,
    detail: { categories: [before.map((c) => c.name).join(', '), catalog.map((c) => c.name).join(', ')] },
  });
  res.json({ categories: catalog });
});

router.get('/', auth.requireRole('owner'), async (req, res) => {
  const rows = await db.q('SELECT k, v FROM settings WHERE k IN (?)', [KEYS]);
  const values = Object.fromEntries(KEYS.map((k) => [k, null]));
  for (const r of rows) values[r.k] = r.v;
  res.json({ settings: values });
});

router.put('/', auth.requireRole('owner'), async (req, res) => {
  const { data, errors, ok } = check(req.body, SPEC);
  if (!ok) return reject(res, errors);
  const before = Object.fromEntries((await db.q('SELECT k, v FROM settings WHERE k IN (?)', [KEYS])).map((r) => [r.k, r.v]));
  const changed = {};
  for (const k of KEYS) {
    await db.q('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, data[k]]);
    if (String(before[k] ?? '') !== String(data[k] ?? '')) changed[k] = [before[k] ?? null, data[k]];
  }
  if (Object.keys(changed).length) await audit(req, 'settings.updated', { entity: 'settings', summary: 'Updated firm details', detail: changed });
  res.json({ settings: data });
});

module.exports = router;
