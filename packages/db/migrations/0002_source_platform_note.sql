-- Additional columns required by the source-inspection and structured-data layers.

ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS platform_note text;

ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS platform_mechanism text;

-- Allow a stable identifier for entity display photos without an extra join in hot paths.
ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS readiness_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS readiness_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS readiness_checked_at timestamptz;

-- Track the number of corrections between readiness runs so the second pass can report it.
ALTER TABLE readiness_runs
  ADD COLUMN IF NOT EXISTS ai_narrated boolean NOT NULL DEFAULT false;