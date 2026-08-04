function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export class D1ResearchStore {
  constructor(db) {
    this.db = db;
  }

  async saveHealth(runId, report) {
    await this.db.prepare(`
      INSERT OR REPLACE INTO monitor_health (
        run_id, status, started_at, finished_at, duration_ms, wallets_expected,
        wallets_checked, coverage, error_count, source_lag_seconds,
        signals_generated, copy_candidates, persistence_succeeded, reasons_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      runId,
      report.status,
      report.startedAt,
      report.finishedAt,
      report.durationMs,
      report.walletsExpected,
      report.walletsChecked,
      report.coverage,
      report.errorCount,
      report.sourceLagSeconds,
      report.signalsGenerated,
      report.copyCandidates,
      report.persistenceSucceeded ? 1 : 0,
      JSON.stringify(report.reasons ?? [])
    ).run();
  }

  async latestHealth() {
    const row = await this.db.prepare(
      "SELECT * FROM monitor_health ORDER BY finished_at DESC LIMIT 1"
    ).first();
    if (!row) return null;
    return {
      runId: row.run_id,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      walletsExpected: row.wallets_expected,
      walletsChecked: row.wallets_checked,
      coverage: row.coverage,
      errorCount: row.error_count,
      sourceLagSeconds: row.source_lag_seconds,
      signalsGenerated: row.signals_generated,
      copyCandidates: row.copy_candidates,
      persistenceSucceeded: Boolean(row.persistence_succeeded),
      reasons: parseJson(row.reasons_json, [])
    };
  }

  async loadPaperPortfolio(id = "default") {
    const row = await this.db.prepare(
      "SELECT state_json FROM paper_portfolios WHERE id = ?"
    ).bind(id).first();
    return row ? parseJson(row.state_json, null) : null;
  }

  async savePaperPortfolio(id, state) {
    await this.db.prepare(`
      INSERT INTO paper_portfolios (id, state_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `).bind(id, JSON.stringify(state), new Date().toISOString()).run();
  }

  async saveWalkForward(wallet, categoryScores, evaluatedAt = new Date().toISOString()) {
    const statements = Object.entries(categoryScores ?? {}).map(([category, metrics]) =>
      this.db.prepare(`
        INSERT INTO wallet_walk_forward (wallet, category, score, eligible, evaluated_at, metrics_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(wallet, category) DO UPDATE SET
          score = excluded.score,
          eligible = excluded.eligible,
          evaluated_at = excluded.evaluated_at,
          metrics_json = excluded.metrics_json
      `).bind(
        String(wallet).toLowerCase(),
        category,
        Number(metrics.score) || 0,
        metrics.eligible ? 1 : 0,
        evaluatedAt,
        JSON.stringify(metrics)
      ));
    if (statements.length) await this.db.batch(statements);
  }

  async saveOpportunities(opportunities) {
    const statements = (opportunities ?? []).map((opportunity) =>
      this.db.prepare(`
        INSERT OR IGNORE INTO strategy_opportunities (
          id, strategy, detected_at, question, slug, net_profit, roi_bps, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        opportunity.id,
        opportunity.strategy ?? "UNKNOWN",
        opportunity.detectedAt,
        opportunity.question ?? null,
        opportunity.slug ?? null,
        Number(opportunity.netProfit) || 0,
        Number(opportunity.roiBps) || 0,
        JSON.stringify(opportunity)
      ));
    if (statements.length) await this.db.batch(statements);
  }
}
