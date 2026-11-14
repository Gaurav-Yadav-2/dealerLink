-- Per-business feature switches set by the platform admin. Only switched-off (or explicitly set) features are stored;
-- a feature with no row is ON, so existing businesses keep everything.
CREATE TABLE business_features (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  feature     TEXT NOT NULL,
  enabled     INTEGER NOT NULL CHECK (enabled IN (0,1)),
  updated_by  TEXT REFERENCES users(id),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (business_id, feature)
);
