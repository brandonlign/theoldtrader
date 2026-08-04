import { defaultWhaleState } from "../src/whales/monitor.js";

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export class D1WhaleStore {
  constructor(db) {
    this.db = db;
  }

  async load(wallets) {
    const state = defaultWhaleState();
    if (!wallets.length) return state;
    const placeholders = wallets.map(() => "?").join(",");
    const result = await this.db.prepare(
      `SELECT wallet, last_timestamp_ms, seen_keys_json, baselined_at, updated_at FROM whale_state WHERE wallet IN (${placeholders})`
    ).bind(...wallets.map((item) => item.wallet)).all();
    for (const row of result.results ?? []) {
      state.wallets[row.wallet] = {
        lastTimestampMs: Number(row.last_timestamp_ms) || 0,
        seenKeys: parseJson(row.seen_keys_json, []),
        baselinedAt: row.baselined_at || undefined,
        updatedAt: row.updated_at || undefined
      };
    }
    const signals = await this.db.prepare(
      "SELECT * FROM whale_signals ORDER BY detected_at DESC LIMIT 100"
    ).all();
    state.recentSignals = (signals.results ?? []).map((row) => ({
      id: row.id,
      detectedAt: row.detected_at,
      wallet: row.wallet,
      walletName: row.wallet_name,
      walletScore: row.wallet_score,
      effectiveWalletScore: row.effective_wallet_score,
      category: row.category,
      asset: row.asset,
      conditionId: row.condition_id,
      title: row.title,
      slug: row.slug,
      outcome: row.outcome,
      whaleSide: row.whale_side,
      whalePrice: row.whale_price,
      whaleShares: row.whale_shares,
      whaleNotional: row.whale_notional,
      relativeConviction: row.relative_conviction,
      detectionDelaySeconds: row.detection_delay_seconds,
      copyShares: row.copy_shares,
      copyAveragePrice: row.copy_average_price,
      copyWorstPrice: row.copy_worst_price,
      estimatedFee: row.estimated_fee,
      estimatedCost: row.estimated_cost,
      slippagePoints: row.slippage_points,
      slippageBps: row.slippage_bps,
      consensusCount: row.consensus_count,
      decision: row.decision,
      reasons: parseJson(row.reasons_json, [])
    }));
    return state;
  }

  async save(result, startedAt) {
    const statements = [];
    for (const [wallet, cursor] of Object.entries(result.state.wallets ?? {})) {
      statements.push(this.db.prepare(`
        INSERT INTO whale_state (wallet, last_timestamp_ms, seen_keys_json, baselined_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(wallet) DO UPDATE SET
          last_timestamp_ms = excluded.last_timestamp_ms,
          seen_keys_json = excluded.seen_keys_json,
          baselined_at = COALESCE(whale_state.baselined_at, excluded.baselined_at),
          updated_at = excluded.updated_at
      `).bind(
        wallet,
        Number(cursor.lastTimestampMs) || 0,
        JSON.stringify(cursor.seenKeys ?? []),
        cursor.baselinedAt ?? null,
        cursor.updatedAt ?? result.observedAt
      ));
    }

    for (const signal of result.signals ?? []) {
      statements.push(this.db.prepare(`
        INSERT OR IGNORE INTO whale_signals (
          id, detected_at, wallet, wallet_name, wallet_score, effective_wallet_score,
          category, asset, condition_id, title, slug, outcome, whale_side, whale_price,
          whale_shares, whale_notional, relative_conviction, detection_delay_seconds,
          copy_shares, copy_average_price, copy_worst_price, estimated_fee, estimated_cost,
          slippage_points, slippage_bps, consensus_count, decision, reasons_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        signal.id, signal.detectedAt, signal.wallet, signal.walletName ?? null,
        signal.walletScore, signal.effectiveWalletScore, signal.category, signal.asset,
        signal.conditionId, signal.title ?? null, signal.slug ?? null, signal.outcome ?? null,
        signal.whaleSide, signal.whalePrice, signal.whaleShares, signal.whaleNotional,
        signal.relativeConviction, signal.detectionDelaySeconds, signal.copyShares,
        signal.copyAveragePrice, signal.copyWorstPrice, signal.estimatedFee, signal.estimatedCost,
        signal.slippagePoints, signal.slippageBps, signal.consensusCount ?? 1,
        signal.decision, JSON.stringify(signal.reasons ?? [])
      ));
    }

    const runId = crypto.randomUUID();
    const candidates = (result.signals ?? []).filter((signal) => signal.decision === "COPY_CANDIDATE").length;
    statements.push(this.db.prepare(`
      INSERT INTO whale_runs (
        id, started_at, finished_at, wallets_checked, wallets_baselined,
        new_trades, copy_candidates, rejected, error_count, errors_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      runId, startedAt, result.observedAt, result.walletsChecked, result.baselined.length,
      result.newTrades, candidates, (result.signals ?? []).length - candidates,
      result.errors.length, JSON.stringify(result.errors)
    ));

    if (statements.length) await this.db.batch(statements);
    return runId;
  }

  async status() {
    const lastRun = await this.db.prepare("SELECT * FROM whale_runs ORDER BY finished_at DESC LIMIT 1").first();
    const totals = await this.db.prepare(`
      SELECT
        COUNT(*) AS signals,
        SUM(CASE WHEN decision = 'COPY_CANDIDATE' THEN 1 ELSE 0 END) AS candidates,
        COUNT(DISTINCT wallet) AS wallets
      FROM whale_signals
    `).first();
    return { lastRun: lastRun ?? null, totals: totals ?? { signals: 0, candidates: 0, wallets: 0 } };
  }

  async signals(limit = 100) {
    const result = await this.db.prepare(
      "SELECT * FROM whale_signals ORDER BY detected_at DESC LIMIT ?"
    ).bind(Math.min(500, Math.max(1, Number(limit) || 100))).all();
    return (result.results ?? []).map((row) => ({
      id: row.id,
      detectedAt: row.detected_at,
      wallet: row.wallet,
      walletName: row.wallet_name,
      walletScore: row.wallet_score,
      category: row.category,
      title: row.title,
      slug: row.slug,
      outcome: row.outcome,
      whalePrice: row.whale_price,
      whaleNotional: row.whale_notional,
      relativeConviction: row.relative_conviction,
      detectionDelaySeconds: row.detection_delay_seconds,
      copyAveragePrice: row.copy_average_price,
      estimatedCost: row.estimated_cost,
      slippagePoints: row.slippage_points,
      consensusCount: row.consensus_count,
      decision: row.decision,
      reasons: parseJson(row.reasons_json, [])
    }));
  }
}
