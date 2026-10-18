-- SmartSpend database schema (SQLite). Run automatically when the server starts.
CREATE TABLE IF NOT EXISTS users (
  user_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id         TEXT,                                -- readable id such as ACC100001, made by the server (unique index is created in db.js)
  full_name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email              TEXT,
  password_hash      TEXT NOT NULL,
  preferred_currency TEXT NOT NULL DEFAULT 'INR',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  role               TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER','ADMIN')),
  is_blocked         INTEGER NOT NULL DEFAULT 0
);
-- Counter behind the Account ID. It only ever goes up, so a number is never handed out twice, even after a user is deleted.
CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  category_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  category_name TEXT NOT NULL,
  category_type TEXT NOT NULL CHECK (category_type IN ('INCOME','EXPENSE')),
  UNIQUE (user_id, category_type, category_name)
);
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  category_id      INTEGER NOT NULL REFERENCES categories(category_id),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('INCOME','EXPENSE')),
  amount           REAL NOT NULL CHECK (amount > 0),
  description      TEXT NOT NULL,
  payment_method   TEXT NOT NULL DEFAULT 'Cash',
  notes            TEXT NOT NULL DEFAULT '',
  transaction_date TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, transaction_date);
CREATE TABLE IF NOT EXISTS budgets (
  budget_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  category_id   INTEGER REFERENCES categories(category_id) ON DELETE CASCADE, -- NULL = overall budget
  month         TEXT NOT NULL,                                                -- YYYY-MM
  budget_amount REAL NOT NULL CHECK (budget_amount > 0)
);
CREATE TABLE IF NOT EXISTS goals (
  goal_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  goal_name      TEXT NOT NULL,
  target_amount  REAL NOT NULL CHECK (target_amount > 0),
  current_amount REAL NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  target_date    TEXT NOT NULL,
  saved_date     TEXT
);
CREATE TABLE IF NOT EXISTS investments (
  investment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  inv_type      TEXT NOT NULL,
  invested      REAL NOT NULL CHECK (invested > 0),
  current_value REAL NOT NULL CHECK (current_value >= 0),
  buy_date      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  notification_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  message           TEXT NOT NULL,
  is_read           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
-- ---- Admin dashboard additions (all idempotent; no existing table or row is changed) ----
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(transaction_date);
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS admin_logs (
  log_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   INTEGER,                      -- user_id of the person who acted (kept even if that user is later deleted)
  admin_name TEXT NOT NULL DEFAULT '',
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  result     TEXT NOT NULL CHECK (result IN ('SUCCESS','FAILED','DENIED')),
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_time ON admin_logs(created_at);
CREATE TABLE IF NOT EXISTS support_requests (
  request_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  account_id TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT 'SUPPORT' CHECK (kind IN ('SUPPORT','FEEDBACK')),
  subject    TEXT NOT NULL,
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED')),
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_support_status ON support_requests(status, created_at);
