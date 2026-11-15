'use strict';
// Command-line tasks. Run from the app folder (cPanel Terminal, after "source" of the Node.js app env):
//   node server/cli.js migrate
//   node server/cli.js create-owner --name "Karthik S" --email partner@ksaca.net
//   node server/cli.js reset-password --email someone@ksaca.net
const db = require('./db');
const auth = require('./auth');
const { migrate } = require('./migrate');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cmd = process.argv[2];
  await migrate();

  if (cmd === 'migrate') {
    console.log('Database is up to date.');
  } else if (cmd === 'create-owner') {
    const name = (arg('name') || '').trim();
    const email = (arg('email') || '').trim().toLowerCase();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: create-owner --name "Full Name" --email you@firm.com');
    if (await db.one('SELECT id FROM employees WHERE email = ?', [email])) throw new Error('An employee with this email already exists.');
    const password = auth.tempPassword();
    await db.q(
      "INSERT INTO employees (name, email, role, designation, password_hash, must_change_pw) VALUES (?, ?, 'owner', 'Partner', ?, 1)",
      [name, email, await auth.hashPassword(password)]
    );
    await db.q("INSERT INTO audit_log (actor_name, action, entity, summary) VALUES ('System', 'employee.created', 'employee', ?)", [`Owner account created for ${name} (command line)`]);
    console.log(`Owner created.\n  Email:              ${email}\n  Temporary password: ${password}\nThey will be asked to set a new password on first sign-in.`);
  } else if (cmd === 'reset-password') {
    const email = (arg('email') || '').trim().toLowerCase();
    const emp = await db.one('SELECT id, name FROM employees WHERE email = ?', [email]);
    if (!emp) throw new Error('No employee with that email.');
    const password = auth.tempPassword();
    await db.q('UPDATE employees SET password_hash = ?, must_change_pw = 1, failed_attempts = 0, locked_until = NULL, auth_version = auth_version + 1 WHERE id = ?',
      [await auth.hashPassword(password), emp.id]);
    await db.q('DELETE FROM sessions WHERE employee_id = ?', [emp.id]);
    await db.q("INSERT INTO audit_log (actor_name, action, entity, entity_id, summary) VALUES ('System', 'employee.password_reset', 'employee', ?, ?)", [String(emp.id), `Password reset for ${emp.name} (command line)`]);
    console.log(`Temporary password for ${emp.name}: ${password}`);
  } else {
    console.log('Commands: migrate | create-owner --name "Name" --email e@x.com | reset-password --email e@x.com');
  }
}

main()
  .catch((err) => { console.error(err.message || err); process.exitCode = 1; })
  .finally(() => db.pool.end());
