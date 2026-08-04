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

-- Shared hosted paper portfolio. These tables are the source of truth for the Vercel dashboard.
CREATE TABLE IF NOT EXISTS hosted_portfolio (
  id TEXT PRIMARY KEY,
  starting_cash REAL NOT NULL,
  cash REAL NOT NULL,
  realized_pnl REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hosted_positions (
  token_id TEXT NOT NULL,
  strategy TEXT NOT NULL,
  market_key TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'uncategorized',
  side TEXT NOT NULL,
  shares REAL NOT NULL,
  cost_basis REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (token_id, strategy, market_key)
);

CREATE INDEX IF NOT EXISTS hosted_positions_strategy_idx ON hosted_positions(strategy, updated_at DESC);
CREATE INDEX IF NOT EXISTS hosted_positions_market_idx ON hosted_positions(market_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS hosted_opportunities (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  strategy TEXT NOT NULL,
  market_key TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  question TEXT,
  slug TEXT,
  net_profit REAL NOT NULL DEFAULT 0,
  roi_bps REAL NOT NULL DEFAULT 0,
  capital_required REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS hosted_opportunities_run_idx ON hosted_opportunities(run_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS hosted_opportunities_strategy_idx ON hosted_opportunities(strategy, detected_at DESC);

CREATE TABLE IF NOT EXISTS hero_decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  duplicate_key TEXT NOT NULL,
  strategy TEXT NOT NULL,
  market_key TEXT NOT NULL,
  selected INTEGER NOT NULL,
  requested_capital REAL NOT NULL,
  allocated_capital REAL NOT NULL,
  reasons_json TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  decided_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS hero_decisions_run_idx ON hero_decisions(run_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS hero_decisions_selected_idx ON hero_decisions(selected, decided_at DESC);
CREATE INDEX IF NOT EXISTS hero_decisions_duplicate_idx ON hero_decisions(duplicate_key, decided_at DESC);

CREATE TABLE IF NOT EXISTS hosted_executions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  duplicate_key TEXT NOT NULL,
  strategy TEXT NOT NULL,
  market_key TEXT NOT NULL,
  status TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  capital_required REAL NOT NULL DEFAULT 0,
  cash_delta REAL NOT NULL DEFAULT 0,
  realized_pnl REAL NOT NULL DEFAULT 0,
  applied INTEGER NOT NULL DEFAULT 0,
  reasons_json TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS hosted_executions_run_idx ON hosted_executions(run_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS hosted_executions_strategy_idx ON hosted_executions(strategy, executed_at DESC);
CREATE INDEX IF NOT EXISTS hosted_executions_duplicate_idx ON hosted_executions(duplicate_key, executed_at DESC);

CREATE TABLE IF NOT EXISTS hosted_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  health TEXT,
  simulation_enabled INTEGER NOT NULL DEFAULT 0,
  rotation_json TEXT NOT NULL DEFAULT '{}',
  opportunities INTEGER NOT NULL DEFAULT 0,
  selected INTEGER NOT NULL DEFAULT 0,
  executions INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS hosted_runs_started_idx ON hosted_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS hosted_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
