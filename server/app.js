'use strict';
require('./async-errors');
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const auth = require('./auth');
const { securityHeaders, sameOrigin } = require('./security');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', 'strong');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(securityHeaders);

  // ---------- API ----------
  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(sameOrigin);
  api.use(auth.loadSession);

  api.get('/health', (req, res) => res.json({ ok: true }));
  api.use('/auth', require('./routes/auth'));
  api.use('/dashboard', auth.requireAuth, require('./routes/dashboard'));
  api.use('/clients', auth.requireAuth, require('./routes/clients'));
  api.use('/engagements', auth.requireAuth, require('./routes/engagements'));
  api.use('/notices', auth.requireAuth, require('./routes/notices'));
  api.use('/vault', auth.requireAuth, require('./routes/vault'));
  api.use('/employees', auth.requireAuth, require('./routes/employees'));
  api.use('/settings', auth.requireAuth, require('./routes/settings'));
  api.use('/activity', auth.requireAuth, require('./routes/activity'));
  api.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This record already exists.' });
    console.error('[api]', req.method, req.originalUrl, err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  app.use('/api', api);

  // ---------- Front end (Astro build output) ----------
  const dist = config.distDir;
  if (!fs.existsSync(dist)) {
    app.get('*', (req, res) => res.status(503).type('text').send('Front end not built. Run "npm run build".'));
    return app;
  }

  // Hashed Astro assets never change: cache for a year.
  app.use('/_astro', express.static(path.join(dist, '_astro'), { immutable: true, maxAge: '365d', index: false }));
  // Service worker must always be revalidated so updates reach phones quickly.
  app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.join(dist, 'sw.js'));
  });
  app.use(express.static(dist, {
    extensions: ['html'],
    index: 'index.html',
    setHeaders(res, file) {
      res.setHeader('Cache-Control', file.endsWith('.html') ? 'no-cache' : 'public, max-age=86400');
    },
  }));
  app.use((req, res) => {
    const notFound = path.join(dist, '404.html');
    if (fs.existsSync(notFound)) return res.status(404).sendFile(notFound);
    res.status(404).type('text').send('Not found');
  });
  return app;
}

module.exports = { createApp };
