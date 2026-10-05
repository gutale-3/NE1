-- D1 database "ne-accounts" (binding DB). Applied once; kept here for reference.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  picture TEXT,
  role TEXT NOT NULL DEFAULT 'customer',      -- customer | technician | admin
  technician_status TEXT,                     -- pending | approved | rejected
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                        -- SHA-256 of the cookie value
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,                -- ms since epoch
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS technician_applications (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  business TEXT,
  town TEXT NOT NULL,
  years TEXT,
  cert_number TEXT,
  work_link TEXT,
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | rejected | removed
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,                         -- NE-1001, NE-1002, ...
  view_token TEXT NOT NULL,                   -- lets the buyer open /order without signing in
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  delivery TEXT NOT NULL,                     -- pickup | nairobi | outside
  town TEXT,
  transport TEXT,                             -- courier | bus | other (outside Nairobi)
  notes TEXT,
  items_json TEXT NOT NULL,                   -- [{slug, model, name, qty, price}]
  subtotal INTEGER NOT NULL,
  tech_discount INTEGER NOT NULL DEFAULT 0,
  reward_used INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  earn_rate REAL NOT NULL DEFAULT 0,          -- reward % earned when marked paid
  reward_earned INTEGER NOT NULL DEFAULT 0,
  channel TEXT NOT NULL,                      -- whatsapp | website
  consent INTEGER NOT NULL DEFAULT 0,         -- agreed to WhatsApp/email updates
  status TEXT NOT NULL DEFAULT 'new',         -- new | confirmed | paid | delivered | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS reward_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  order_id INTEGER REFERENCES orders(id),
  kind TEXT NOT NULL,                         -- earn | spend
  amount INTEGER NOT NULL,                    -- KES, always positive
  expires_at TEXT,                            -- earn rows only
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS reward_user ON reward_ledger(user_id);
