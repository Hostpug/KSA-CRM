'use strict';
// Entry point. In cPanel > Setup Node.js App, set "Application startup file" to app.js.
const config = require('./server/config');
const { migrate } = require('./server/migrate');
const { createApp } = require('./server/app');
const auth = require('./server/auth');

async function start() {
  await migrate();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[ksa-crm] listening on ${config.port} (${config.isProd ? 'production' : 'development'})`);
  });
  // Clear old sessions hourly while the app is awake.
  setInterval(() => auth.purgeExpiredSessions().catch(() => {}), 60 * 60 * 1000).unref();
}

start().catch((err) => {
  console.error('[ksa-crm] failed to start:', err);
  process.exit(1);
});
