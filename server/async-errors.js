'use strict';
// Express 4 does not pass rejected promises from async handlers to the error handler.
// This forwards them (same approach as the express-async-errors package, without the dependency).
const Layer = require('express/lib/router/layer');

const original = Layer.prototype.handle_request;
Layer.prototype.handle_request = function handle(req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return original.call(this, req, res, next); // error middleware
  try {
    const out = fn(req, res, next);
    if (out && typeof out.then === 'function') out.catch(next);
  } catch (err) {
    next(err);
  }
};
