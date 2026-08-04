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
