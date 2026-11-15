'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Minimal .env loader (works on every Node version cPanel offers).
// Values already set in the environment (cPanel UI) win over the file.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile(path.join(ROOT, '.env'));

const env = process.env;
const isProd = env.NODE_ENV === 'production';

const config = {
  root: ROOT,
  isProd,
  port: Number(env.PORT || 3000),
  appUrl: (env.APP_URL || '').replace(/\/+$/, ''),
  trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
  sessionHours: Math.min(Math.max(Number(env.SESSION_HOURS || 8), 1), 24),
  db: {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 3306),
    database: env.DB_NAME || 'ksacrm',
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
  },
  distDir: path.join(ROOT, 'dist'),
};

module.exports = config;
