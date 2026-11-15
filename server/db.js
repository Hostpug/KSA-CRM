'use strict';
const mysql = require('mysql2/promise');
const config = require('./config');

// Small pool: shared hosting limits concurrent connections.
const pool = mysql.createPool({
  ...config.db,
  connectionLimit: 5,
  waitForConnections: true,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: true, // DATE/DATETIME come back as plain strings (stored in UTC)
  supportBigNumbers: true,
  multipleStatements: false,
});

// Every connection works in UTC. The browser converts to IST for display.
pool.pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

/** Run a parameterised query and return rows (or the result header for writes). */
async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** Return the first row or null. */
async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

/** Run fn inside a transaction with a dedicated connection. */
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const helpers = {
      q: async (sql, params = []) => (await conn.query(sql, params))[0],
      one: async (sql, params = []) => (await conn.query(sql, params))[0][0] || null,
    };
    const result = await fn(helpers);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, q, one, tx };
