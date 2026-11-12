-- Web Push alerts: browser push subscriptions, and a marker so each notification is pushed at most once.

ALTER TABLE notifications ADD COLUMN pushed_at TEXT;
-- Existing notifications are treated as already handled so they are never pushed retroactively.
UPDATE notifications SET pushed_at = created_at;
CREATE INDEX idx_notifications_unpushed ON notifications(created_at) WHERE pushed_at IS NULL;

CREATE TABLE push_subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,   -- push service URL issued by the browser (one per browser profile)
  p256dh     TEXT NOT NULL,          -- browser's public key (base64url), used to encrypt the message
  auth       TEXT NOT NULL,          -- browser's auth secret (base64url)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
