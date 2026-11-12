-- Idle timeout: remember when each session was last used. Sessions unused for longer than the idle limit are rejected.
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
UPDATE sessions SET last_seen_at = created_at;
CREATE INDEX idx_sessions_user_seen ON sessions(user_id, last_seen_at);
