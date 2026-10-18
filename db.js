'use strict';
// Opens the SQLite database. Uses Node's built-in SQLite (Node 22.5+); falls back to better-sqlite3 if installed.
const path = require('path'), fs = require('fs');
let open;
try { const { DatabaseSync } = require('node:sqlite'); open = f => new DatabaseSync(f); }
catch (e) {
  try { const B = require('better-sqlite3'); open = f => new B(f); }
  catch (e2) { console.error('SmartSpend needs Node.js 22.5 or newer (built-in SQLite), or run: npm install better-sqlite3'); process.exit(1); }
}
const db = open(process.env.DB_FILE || path.join(__dirname, 'smartspend.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
// Upgrade databases created before the admin feature (adds the two new user columns).
const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!cols.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'USER'");
if (!cols.includes('is_blocked')) db.exec('ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0');

// Account IDs (ACC100001, ACC100002, ...). Existing users are numbered in sign-up order; nobody is deleted or changed otherwise.
// The admin account is not a customer, so it has no Account ID.
if (!cols.includes('account_id')) db.exec('ALTER TABLE users ADD COLUMN account_id TEXT');
db.exec("INSERT OR IGNORE INTO counters(name,value) VALUES('account_id',100000)");   // first user gets 100001
const unnumbered = db.prepare("SELECT user_id FROM users WHERE role='USER' AND account_id IS NULL ORDER BY user_id").all();
if (unnumbered.length) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const u of unnumbered) {
      db.prepare("UPDATE counters SET value = value + 1 WHERE name='account_id'").run();
      db.prepare('UPDATE users SET account_id = ? WHERE user_id = ?').run('ACC' + db.prepare("SELECT value FROM counters WHERE name='account_id'").get().value, u.user_id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_users_account_id ON users(account_id)');   // the database itself refuses duplicates
module.exports = db;
