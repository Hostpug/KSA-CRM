'use strict';
// Encryption for the client password vault: AES-256-GCM with a key kept OUTSIDE the database.
//
// Production: set VAULT_KEY (32 random bytes, base64) in cPanel's environment or .env.
//   Generate one with:  npm run vault-key
//   Back it up somewhere safe. Without it the saved passwords cannot be read.
// Development: a key is created in .vault-key (git-ignored) the first time it is needed.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const DEV_KEY_FILE = path.join(config.root, '.vault-key');
let cached = null;

function loadKey() {
  if (cached) return cached;
  let b64 = process.env.VAULT_KEY || '';
  if (!b64 && !config.isProd) {
    if (!fs.existsSync(DEV_KEY_FILE)) fs.writeFileSync(DEV_KEY_FILE, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    b64 = fs.readFileSync(DEV_KEY_FILE, 'utf8').trim();
  }
  const key = b64 ? Buffer.from(b64, 'base64') : null;
  if (!key || key.length !== 32) return null;
  // Short key id stored with every secret, so a wrong key is detected instead of returning garbage.
  cached = { key, kid: crypto.createHash('sha256').update(key).digest('hex').slice(0, 8) };
  return cached;
}

const ready = () => !!loadKey();

/** "v1:<kid>:<base64(iv | tag | ciphertext)>" */
function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const k = loadKey();
  if (!k) throw new Error('VAULT_KEY is not configured');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k.key, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${k.kid}:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
}

function decrypt(stored) {
  if (!stored) return '';
  const k = loadKey();
  if (!k) throw new Error('VAULT_KEY is not configured');
  const [v, kid, b64] = String(stored).split(':');
  if (v !== 'v1' || !b64) throw new Error('Unknown vault format');
  if (kid !== k.kid) throw new Error('This secret was saved with a different VAULT_KEY');
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', k.key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

const newKey = () => crypto.randomBytes(32).toString('base64');

module.exports = { encrypt, decrypt, ready, newKey };
