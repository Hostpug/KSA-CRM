'use strict';
const config = require('./config');

/** Strict security headers for every response. */
function securityHeaders(req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

/** Reject cross-site writes: Origin (or Referer) must be this site. */
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin') || '';
  const referer = req.get('referer') || '';
  const host = req.get('host');
  const allowed = new Set([`https://${host}`, `http://${host}`]);
  if (config.appUrl) allowed.add(config.appUrl);
  const src = origin || (referer ? safeOrigin(referer) : '');
  if (!src || !allowed.has(src)) {
    return res.status(403).json({ error: 'Request blocked (origin check).' });
  }
  next();
}

function safeOrigin(url) {
  try { return new URL(url).origin; } catch (_) { return ''; }
}

/**
 * Tiny in-memory rate limiter (one Node process on shared hosting).
 * key(req) decides the bucket; limit per windowMs.
 */
function rateLimit({ windowMs, limit, key = (req) => req.ip, message = 'Too many requests. Please wait and try again.' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let h = hits.get(k);
    if (!h || h.reset <= now) { h = { count: 0, reset: now + windowMs }; hits.set(k, h); }
    h.count += 1;
    if (h.count > limit) {
      res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { securityHeaders, sameOrigin, rateLimit };
