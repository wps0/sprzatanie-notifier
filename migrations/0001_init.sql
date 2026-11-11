-- Key/value store for singletons: schedule_json, schedule_fetched_at, schedule_error, last_tick.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One row per browser/device that enabled notifications.
CREATE TABLE subscriptions (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  person     TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX subscriptions_person ON subscriptions (person);

-- Per-person reminder rules (JSON array of {dow, time}). No row = defaults.
CREATE TABLE prefs (
  person     TEXT PRIMARY KEY,
  rules_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- A task ticked off for a given week.
CREATE TABLE done (
  week_start TEXT NOT NULL,
  task_key   TEXT NOT NULL,
  done_by    TEXT NOT NULL,
  done_at    INTEGER NOT NULL,
  PRIMARY KEY (week_start, task_key)
);

-- Reminders already claimed for sending; the primary key is what prevents duplicates.
CREATE TABLE sent (
  dedupe_key TEXT PRIMARY KEY,
  sent_at    INTEGER NOT NULL
);
