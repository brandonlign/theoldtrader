CREATE TABLE IF NOT EXISTS whale_state (
  wallet TEXT PRIMARY KEY,
  last_timestamp_ms INTEGER NOT NULL DEFAULT 0,
  seen_keys_json TEXT NOT NULL DEFAULT '[]',
  baselined_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS whale_signals (
  id TEXT PRIMARY KEY,
  detected_at TEXT NOT NULL,
  wallet TEXT NOT NULL,
  wallet_name TEXT,
  wallet_score REAL NOT NULL,
  effective_wallet_score REAL NOT NULL,
  category TEXT NOT NULL,
  asset TEXT NOT NULL,
  condition_id TEXT NOT NULL,
  title TEXT,
  slug TEXT,
  outcome TEXT,
  whale_side TEXT NOT NULL,
  whale_price REAL NOT NULL,
  whale_shares REAL NOT NULL,
  whale_notional REAL NOT NULL,
  relative_conviction REAL NOT NULL,
  detection_delay_seconds REAL NOT NULL,
  copy_shares REAL,
  copy_average_price REAL,
  copy_worst_price REAL,
  estimated_fee REAL,
  estimated_cost REAL,
  slippage_points REAL,
  slippage_bps REAL,
  consensus_count INTEGER NOT NULL DEFAULT 1,
  decision TEXT NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS whale_signals_detected_at_idx ON whale_signals(detected_at DESC);
CREATE INDEX IF NOT EXISTS whale_signals_wallet_idx ON whale_signals(wallet, detected_at DESC);
CREATE INDEX IF NOT EXISTS whale_signals_asset_idx ON whale_signals(asset, detected_at DESC);

CREATE TABLE IF NOT EXISTS whale_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  wallets_checked INTEGER NOT NULL,
  wallets_baselined INTEGER NOT NULL,
  new_trades INTEGER NOT NULL,
  copy_candidates INTEGER NOT NULL,
  rejected INTEGER NOT NULL,
  error_count INTEGER NOT NULL,
  errors_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS monitor_health (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  wallets_expected INTEGER NOT NULL,
  wallets_checked INTEGER NOT NULL,
  coverage REAL NOT NULL,
  error_count INTEGER NOT NULL,
  source_lag_seconds REAL,
  signals_generated INTEGER NOT NULL,
  copy_candidates INTEGER NOT NULL,
  persistence_succeeded INTEGER NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS monitor_health_finished_at_idx ON monitor_health(finished_at DESC);

CREATE TABLE IF NOT EXISTS paper_portfolios (
  id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_walk_forward (
  wallet TEXT NOT NULL,
  category TEXT NOT NULL,
  score REAL NOT NULL,
  eligible INTEGER NOT NULL,
  evaluated_at TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (wallet, category)
);

CREATE TABLE IF NOT EXISTS strategy_opportunities (
  id TEXT PRIMARY KEY,
  strategy TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  question TEXT,
  slug TEXT,
  net_profit REAL NOT NULL,
  roi_bps REAL NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS strategy_opportunities_detected_at_idx ON strategy_opportunities(detected_at DESC);
