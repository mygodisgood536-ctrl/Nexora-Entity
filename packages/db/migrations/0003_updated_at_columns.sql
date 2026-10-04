-- Ensure every table that repositories update carries an updated_at column.

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE portfolio_files
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE opencode_snapshots
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE evidence_minimums
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Keep the platforms table honest: record which mechanism produced platform facts.
ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS platform_fetched_at timestamptz;