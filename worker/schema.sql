-- ============================================================================
-- DRAgNEt Single-Repo Cloudflare D1 Schema (worker/schema.sql)
-- Optimized for Cloudflare Workers Free & D1 Free Tiers:
--   - Every query path hits a primary key or composite index (1-80 rows read)
--   - Replaces Google Drive 05_Master_Discovery_Ledger + 08_daily_dragnet_queue
-- ============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pipeline_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO pipeline_meta (key, value, updated_at)
VALUES ('next_open_block', '3000', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

CREATE TABLE IF NOT EXISTS targets (
  target_id TEXT PRIMARY KEY,
  queue_rank INTEGER NOT NULL,
  priority_band TEXT NOT NULL,
  headword TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  etymology_status TEXT NOT NULL,
  baseline_year INTEGER NOT NULL,
  best_verified_year INTEGER,
  years_antedated INTEGER NOT NULL DEFAULT 0,
  baseline_region TEXT NOT NULL DEFAULT '',
  baseline_summary TEXT NOT NULL DEFAULT '',
  open_question TEXT NOT NULL DEFAULT '',
  prior_audit_context TEXT NOT NULL DEFAULT '',
  consonant_skeleton TEXT NOT NULL DEFAULT '',
  dirty_ocr_regex TEXT NOT NULL DEFAULT '',
  search_variants_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (
    status IN (
      'QUEUED',
      'CLAIMING_DISCOVERY',
      'AWAITING_AUDIT',
      'AUDITING_REDTEAM',
      'STAGE_B_PACK_READY',
      'PR_OPENED',
      'LIVE_ON_DRAGNET',
      'EMBARGOED_UNDER_REVIEW',
      'NEEDS_PHASE_2'
    )
  ),
  assigned_block INTEGER,
  latest_pr_url TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_targets_queue
  ON targets (status, queue_rank);

CREATE INDEX IF NOT EXISTS idx_targets_slug
  ON targets (slug);

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  block_number INTEGER NOT NULL UNIQUE,
  target_id TEXT NOT NULL REFERENCES targets(target_id),
  slug TEXT NOT NULL,
  headword TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'CLAIMING_DISCOVERY',
      'AWAITING_AUDIT',
      'AUDITING_REDTEAM',
      'STAGE_B_PACK_READY',
      'PR_OPENED',
      'NEEDS_PHASE_2',
      'ABORTED_OR_STALLED'
    )
  ),
  proposer_agent TEXT,
  redteam_agent TEXT,
  dossier_markdown TEXT,
  monograph_markdown TEXT,
  audit_report_markdown TEXT,
  case_markdown TEXT,
  oed_slips_markdown TEXT,
  claims_json TEXT,
  prior_art_baselines_json TEXT NOT NULL DEFAULT '{}',
  corpus_search_summary_json TEXT NOT NULL DEFAULT '{}',
  pr_url TEXT,
  pr_number INTEGER,
  notes TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_status
  ON runs (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_runs_target
  ON runs (target_id, block_number DESC);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES targets(target_id),
  case_slug TEXT NOT NULL,
  run_id TEXT REFERENCES runs(run_id),
  headword TEXT NOT NULL,
  attested_form TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (
    record_type IN ('attestation', 'contextual_evidence', 'hypothesis', 'rejected_lead')
  ),
  record_subtype TEXT,
  verification_level TEXT NOT NULL CHECK (
    verification_level IN ('discovered', 'agent_verified', 'human_verified', 'externally_recognized')
  ),
  publication_year INTEGER,
  sort_date TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  masthead_date_verified INTEGER NOT NULL DEFAULT 0,
  scan_hosted_path TEXT,
  scan_bytes INTEGER,
  scan_sha256 TEXT,
  record_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_citations_case_sort
  ON citations (case_slug, sort_date, id);

CREATE INDEX IF NOT EXISTS idx_citations_target
  ON citations (target_id);

CREATE INDEX IF NOT EXISTS idx_citations_run
  ON citations (run_id);
