'use strict';
const db = require('./db');

// Versioned schema. Never edit a released migration; add a new one.
// Works on MySQL 5.7+ and MariaDB 10.3+ (the versions cPanel hosts ship).
const T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

const migrations = [
  {
    version: 1,
    name: 'foundation: employees, sessions, clients, settings, audit',
    sql: [
      `CREATE TABLE IF NOT EXISTS employees (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(190) NOT NULL,
        mobile VARCHAR(20) NULL,
        designation VARCHAR(80) NULL,
        role ENUM('owner','admin','staff') NOT NULL DEFAULT 'staff',
        date_joined DATE NULL,
        dob DATE NULL,
        address VARCHAR(500) NULL,
        emergency_name VARCHAR(120) NULL,
        emergency_phone VARCHAR(20) NULL,
        password_hash VARCHAR(255) NOT NULL,
        must_change_pw TINYINT(1) NOT NULL DEFAULT 1,
        active TINYINT(1) NOT NULL DEFAULT 1,
        auth_version INT UNSIGNED NOT NULL DEFAULT 1,
        failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
        locked_until DATETIME NULL,
        last_login_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_employees_email (email)
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS sessions (
        id CHAR(64) NOT NULL PRIMARY KEY,
        employee_id INT UNSIGNED NOT NULL,
        auth_version INT UNSIGNED NOT NULL,
        csrf CHAR(43) NOT NULL,
        ip VARCHAR(45) NULL,
        user_agent VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        KEY ix_sessions_employee (employee_id),
        KEY ix_sessions_expires (expires_at),
        CONSTRAINT fk_sessions_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS clients (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(160) NOT NULL,
        type ENUM('individual','proprietorship','partnership','llp','company','trust','huf','other') NOT NULL DEFAULT 'individual',
        pan CHAR(10) NULL,
        gstin CHAR(15) NULL,
        contact_person VARCHAR(120) NULL,
        email VARCHAR(190) NULL,
        mobile VARCHAR(20) NULL,
        address VARCHAR(500) NULL,
        city VARCHAR(80) NULL,
        state VARCHAR(60) NULL,
        pincode CHAR(6) NULL,
        notes TEXT NULL,
        assigned_to INT UNSIGNED NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        zoho_contact_id VARCHAR(40) NULL,
        revision INT UNSIGNED NOT NULL DEFAULT 1,
        created_by INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_clients_gstin (gstin),
        KEY ix_clients_name (name),
        KEY ix_clients_pan (pan),
        CONSTRAINT fk_clients_assigned FOREIGN KEY (assigned_to) REFERENCES employees(id) ON DELETE SET NULL,
        CONSTRAINT fk_clients_created FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS settings (
        k VARCHAR(64) NOT NULL PRIMARY KEY,
        v TEXT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS audit_log (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        actor_id INT UNSIGNED NULL,
        actor_name VARCHAR(120) NULL,
        action VARCHAR(60) NOT NULL,
        entity VARCHAR(40) NULL,
        entity_id VARCHAR(40) NULL,
        summary VARCHAR(255) NULL,
        detail TEXT NULL,
        ip VARCHAR(45) NULL,
        KEY ix_audit_at (at),
        KEY ix_audit_entity (entity, entity_id),
        KEY ix_audit_actor (actor_id)
      ) ${T}`,
      `INSERT IGNORE INTO settings (k, v) VALUES
        ('firm_name', 'Karthik S & Associates'),
        ('firm_tagline', 'Chartered Accountants'),
        ('firm_email', NULL),
        ('firm_phone', NULL),
        ('firm_address', NULL),
        ('firm_gstin', NULL)`,
    ],
  },
  {
    version: 2,
    name: 'practice workflow: engagements, estimate items, numbering',
    sql: [
      `CREATE TABLE IF NOT EXISTS counters (
        name VARCHAR(40) NOT NULL PRIMARY KEY,
        value INT UNSIGNED NOT NULL
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS engagements (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        kind ENUM('sales','direct') NOT NULL,
        stage TINYINT UNSIGNED NOT NULL,
        client_id INT UNSIGNED NULL,
        prospect_name VARCHAR(160) NULL,
        contact VARCHAR(250) NULL,
        service VARCHAR(250) NOT NULL,
        fee DECIMAL(13,2) NULL,
        estimate_no VARCHAR(30) NULL,
        estimate_date DATE NULL,
        estimate_valid_until DATE NULL,
        estimate_notes TEXT NULL,
        so_no VARCHAR(30) NULL,
        so_date DATE NULL,
        work_date DATE NULL,
        assigned_to INT UNSIGNED NULL,
        reviewer_id INT UNSIGNED NULL,
        due_date DATE NULL,
        pending_info TEXT NULL,
        delivered_on DATE NULL,
        notes TEXT NULL,
        close_reason VARCHAR(250) NULL,
        revision INT UNSIGNED NOT NULL DEFAULT 1,
        created_by INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        stage_changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_eng_estimate_no (estimate_no),
        UNIQUE KEY uq_eng_so_no (so_no),
        KEY ix_eng_stage (stage),
        KEY ix_eng_client (client_id),
        KEY ix_eng_assigned (assigned_to, stage),
        KEY ix_eng_due (due_date),
        KEY ix_eng_updated (updated_at),
        CONSTRAINT fk_eng_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
        CONSTRAINT fk_eng_assigned FOREIGN KEY (assigned_to) REFERENCES employees(id) ON DELETE SET NULL,
        CONSTRAINT fk_eng_reviewer FOREIGN KEY (reviewer_id) REFERENCES employees(id) ON DELETE SET NULL,
        CONSTRAINT fk_eng_created FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS estimate_items (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        engagement_id INT UNSIGNED NOT NULL,
        position SMALLINT UNSIGNED NOT NULL,
        description VARCHAR(250) NOT NULL,
        amount DECIMAL(13,2) NOT NULL,
        KEY ix_items_eng (engagement_id, position),
        CONSTRAINT fk_items_eng FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
      ) ${T}`,
    ],
  },
  {
    version: 3,
    name: 'service categories on engagements',
    sql: [
      'ALTER TABLE engagements ADD COLUMN category VARCHAR(40) NULL AFTER service, ADD KEY ix_eng_category (category)',
    ],
  },
  {
    version: 4,
    name: 'GST and income tax notice tracker',
    sql: [
      `CREATE TABLE IF NOT EXISTS notices (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tax ENUM('gst','it') NOT NULL,
        client_id INT UNSIGNED NOT NULL,
        tax_id VARCHAR(15) NULL,
        type_code VARCHAR(20) NOT NULL,
        act VARCHAR(10) NULL,
        section VARCHAR(60) NULL,
        ref_no VARCHAR(80) NULL,
        period VARCHAR(60) NULL,
        subject VARCHAR(500) NOT NULL,
        authority VARCHAR(250) NULL,
        tax_amount DECIMAL(15,2) NULL,
        interest_amount DECIMAL(15,2) NULL,
        penalty_amount DECIMAL(15,2) NULL,
        notice_date DATE NULL,
        received_date DATE NULL,
        stage TINYINT UNSIGNED NOT NULL DEFAULT 1,
        next_action VARCHAR(250) NULL,
        next_due DATE NULL,
        reply_due DATE NULL,
        hearing_date DATE NULL,
        order_date DATE NULL,
        outcome VARCHAR(120) NULL,
        demand_amount DECIMAL(15,2) NULL,
        appeal_due DATE NULL,
        assigned_to INT UNSIGNED NULL,
        reviewer_id INT UNSIGNED NULL,
        notes TEXT NULL,
        closed_on DATE NULL,
        revision INT UNSIGNED NOT NULL DEFAULT 1,
        created_by INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY ix_not_tax_stage (tax, stage),
        KEY ix_not_due (next_due),
        KEY ix_not_client (client_id),
        KEY ix_not_assigned (assigned_to, stage),
        CONSTRAINT fk_not_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
        CONSTRAINT fk_not_assigned FOREIGN KEY (assigned_to) REFERENCES employees(id) ON DELETE SET NULL,
        CONSTRAINT fk_not_reviewer FOREIGN KEY (reviewer_id) REFERENCES employees(id) ON DELETE SET NULL,
        CONSTRAINT fk_not_created FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS notice_events (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        notice_id INT UNSIGNED NOT NULL,
        event VARCHAR(30) NOT NULL,
        label VARCHAR(120) NOT NULL,
        event_date DATE NOT NULL,
        ref VARCHAR(120) NULL,
        notes TEXT NULL,
        stage_after TINYINT UNSIGNED NULL,
        next_due DATE NULL,
        created_by INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY ix_nev_notice (notice_id, event_date),
        CONSTRAINT fk_nev_notice FOREIGN KEY (notice_id) REFERENCES notices(id) ON DELETE CASCADE,
        CONSTRAINT fk_nev_created FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL
      ) ${T}`,
    ],
  },
  {
    version: 5,
    name: 'notices: room for several years in the period',
    sql: ['ALTER TABLE notices MODIFY period VARCHAR(200) NULL'],
  },
  {
    version: 6,
    name: 'notices: officer name, designation and location',
    sql: [
      `ALTER TABLE notices
        ADD COLUMN officer_name VARCHAR(120) NULL AFTER authority,
        ADD COLUMN officer_designation VARCHAR(120) NULL AFTER officer_name,
        ADD COLUMN officer_location VARCHAR(160) NULL AFTER officer_designation`,
    ],
  },
  {
    version: 7,
    name: 'engagements: details of a new prospect (used to create the client)',
    sql: [
      `ALTER TABLE engagements
        ADD COLUMN prospect_type VARCHAR(20) NULL AFTER prospect_name,
        ADD COLUMN prospect_pan CHAR(10) NULL AFTER prospect_type,
        ADD COLUMN prospect_gstin CHAR(15) NULL AFTER prospect_pan,
        ADD COLUMN prospect_person VARCHAR(120) NULL AFTER prospect_gstin,
        ADD COLUMN prospect_mobile VARCHAR(20) NULL AFTER prospect_person,
        ADD COLUMN prospect_email VARCHAR(190) NULL AFTER prospect_mobile,
        ADD COLUMN prospect_city VARCHAR(80) NULL AFTER prospect_email,
        ADD COLUMN prospect_state VARCHAR(60) NULL AFTER prospect_city`,
    ],
  },
  {
    version: 8,
    name: 'notices linked to sales orders for billing',
    sql: [
      `CREATE TABLE IF NOT EXISTS notice_links (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        notice_id INT UNSIGNED NOT NULL,
        engagement_id INT UNSIGNED NOT NULL,
        purpose VARCHAR(20) NOT NULL,
        created_by INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_nl (notice_id, engagement_id),
        KEY ix_nl_eng (engagement_id),
        CONSTRAINT fk_nl_notice FOREIGN KEY (notice_id) REFERENCES notices(id) ON DELETE CASCADE,
        CONSTRAINT fk_nl_eng FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
        CONSTRAINT fk_nl_created FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL
      ) ${T}`,
      `ALTER TABLE notices
        ADD COLUMN no_charge TINYINT(1) NOT NULL DEFAULT 0 AFTER notes,
        ADD COLUMN no_charge_note VARCHAR(160) NULL AFTER no_charge`,
    ],
  },
  {
    version: 9,
    name: 'password vault for client portal logins',
    sql: [
      `CREATE TABLE IF NOT EXISTS vault_items (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        client_id INT UNSIGNED NOT NULL,
        portal VARCHAR(30) NOT NULL,
        label VARCHAR(120) NULL,
        username VARCHAR(160) NOT NULL,
        secret TEXT NULL,
        notes_secret TEXT NULL,
        reg_mobile VARCHAR(20) NULL,
        reg_email VARCHAR(190) NULL,
        url VARCHAR(250) NULL,
        changed_on DATE NULL,
        revision INT UNSIGNED NOT NULL DEFAULT 1,
        created_by INT UNSIGNED NULL,
        updated_by INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY ix_vault_client (client_id, portal),
        CONSTRAINT fk_vault_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
        CONSTRAINT fk_vault_created FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL,
        CONSTRAINT fk_vault_updated FOREIGN KEY (updated_by) REFERENCES employees(id) ON DELETE SET NULL
      ) ${T}`,
      'ALTER TABLE sessions ADD COLUMN vault_until DATETIME NULL',
    ],
  },
];

async function migrate(log = console.log) {
  await db.q(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INT UNSIGNED NOT NULL PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ${T}`);

  // Only one process migrates at a time (Passenger can start several).
  const lock = await db.one("SELECT GET_LOCK('ksacrm_migrate', 30) AS got");
  if (!lock || Number(lock.got) !== 1) throw new Error('Could not get the migration lock');
  try {
    const done = new Set((await db.q('SELECT version FROM schema_migrations')).map((r) => Number(r.version)));
    for (const m of migrations) {
      if (done.has(m.version)) continue;
      log(`[migrate] applying ${m.version}: ${m.name}`);
      for (const stmt of m.sql) await db.q(stmt);
      await db.q('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [m.version, m.name]);
    }
  } finally {
    await db.q("SELECT RELEASE_LOCK('ksacrm_migrate')");
  }
}

module.exports = { migrate };
