function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function limit(value, fallback = 50, maximum = 200) {
  return Math.max(1, Math.min(maximum, Math.trunc(finite(value, fallback))));
}

export class HostedPaperStore {
  constructor(db) {
    this.db = db;
  }

  async ensurePortfolio(startingCash = 10_000) {
    const now = new Date().toISOString();
    await this.db.prepare(`
      INSERT INTO hosted_portfolio (id, starting_cash, cash, realized_pnl, updated_at)
      VALUES ('paper', ?1, ?1, 0, ?2)
      ON CONFLICT(id) DO NOTHING
    `).bind(finite(startingCash, 10_000), now).run();
  }

  async loadPortfolio(startingCash = 10_000) {
    await this.ensurePortfolio(startingCash);
    const row = await this.db.prepare("SELECT * FROM hosted_portfolio WHERE id = 'paper'").first();
    const positions = await this.db.prepare(`
      SELECT token_id AS tokenId, strategy, market_key AS marketKey, category, side,
             shares, cost_basis AS costBasis, updated_at AS updatedAt
      FROM hosted_positions
      WHERE ABS(shares) > 0.0000001
      ORDER BY cost_basis DESC
    `).all();
    return {
      id: "paper",
      startingCash: finite(row?.starting_cash, startingCash),
      cash: finite(row?.cash, startingCash),
      realizedPnl: finite(row?.realized_pnl, 0),
      updatedAt: row?.updated_at ?? null,
      positions: positions.results ?? [],
      openPositionValue: (positions.results ?? []).reduce((sum, item) => sum + Math.max(0, finite(item.costBasis, 0)), 0)
    };
  }

  async acquireCycleLock(owner, ttlMs = 240_000) {
    const nowMs = Date.now();
    const result = await this.db.prepare(`
      INSERT INTO hosted_locks (name, owner, expires_at, updated_at)
      VALUES ('cycle', ?1, ?2, ?3)
      ON CONFLICT(name) DO UPDATE SET
        owner = excluded.owner, expires_at = excluded.expires_at, updated_at = excluded.updated_at
      WHERE hosted_locks.expires_at < ?4
    `).bind(String(owner), nowMs + Math.max(30_000, finite(ttlMs, 240_000)), new Date(nowMs).toISOString(), nowMs).run();
    return finite(result?.meta?.changes, 0) > 0;
  }

  async releaseCycleLock(owner) {
    await this.db.prepare("DELETE FROM hosted_locks WHERE name = 'cycle' AND owner = ?1").bind(String(owner)).run();
  }

  async rotation() {
    const row = await this.db.prepare("SELECT value_json FROM hosted_state WHERE key = 'rotation'").first();
    return parseJson(row?.value_json, { marketOffset: 0, eventOffset: 0, run: 0 });
  }

  async advanceRotation(current, options = {}) {
    const marketWindow = Math.max(1, Math.trunc(finite(options.marketWindow, 600)));
    const eventWindow = Math.max(1, Math.trunc(finite(options.eventWindow, 100)));
    const marketBatch = Math.max(1, Math.trunc(finite(options.marketBatch, 30)));
    const eventBatch = Math.max(1, Math.trunc(finite(options.eventBatch, 5)));
    const next = {
      marketOffset: (Math.trunc(finite(current.marketOffset, 0)) + marketBatch) % marketWindow,
      eventOffset: (Math.trunc(finite(current.eventOffset, 0)) + eventBatch) % eventWindow,
      run: Math.trunc(finite(current.run, 0)) + 1
    };
    await this.db.prepare(`
      INSERT INTO hosted_state (key, value_json, updated_at) VALUES ('rotation', ?1, ?2)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).bind(JSON.stringify(next), new Date().toISOString()).run();
    return next;
  }

  async startRun({ id, status, enabled, rotation }) {
    const now = new Date().toISOString();
    await this.db.prepare(`
      INSERT INTO hosted_runs (id, started_at, status, simulation_enabled, rotation_json)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `).bind(id, now, status, enabled ? 1 : 0, JSON.stringify(rotation ?? {})).run();
    return now;
  }

  async finishRun(id, summary = {}) {
    const now = new Date().toISOString();
    await this.db.prepare(`
      UPDATE hosted_runs
      SET finished_at = ?2, status = ?3, health = ?4, opportunities = ?5,
          selected = ?6, executions = ?7, error_count = ?8, summary_json = ?9
      WHERE id = ?1
    `).bind(
      id,
      now,
      summary.status ?? "HEALTHY",
      summary.health ?? summary.status ?? "HEALTHY",
      finite(summary.opportunities, 0),
      finite(summary.selected, 0),
      finite(summary.executions, 0),
      Array.isArray(summary.errors) ? summary.errors.length : finite(summary.errorCount, 0),
      JSON.stringify(summary)
    ).run();
    return now;
  }

  async saveOpportunities(runId, candidates = []) {
    if (!candidates.length) return;
    const statements = candidates.map((item) => this.db.prepare(`
      INSERT INTO hosted_opportunities (
        id, run_id, strategy, market_key, detected_at, question, slug,
        net_profit, roi_bps, capital_required, payload_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
      ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id, detected_at = excluded.detected_at,
        net_profit = excluded.net_profit, roi_bps = excluded.roi_bps,
        capital_required = excluded.capital_required, payload_json = excluded.payload_json
    `).bind(
      String(item.id), runId, String(item.strategy), String(item.marketKey ?? item.conditionId ?? item.eventId ?? item.asset ?? item.id),
      item.detectedAt ?? new Date().toISOString(), item.question ?? item.title ?? null, item.slug ?? null,
      finite(item.netProfit, 0), finite(item.roiBps, 0), finite(item.capitalRequired ?? item.estimatedCost, 0), JSON.stringify(item)
    ));
    await this.db.batch(statements);
  }

  async saveDecisions(runId, decisions = []) {
    if (!decisions.length) return;
    const now = new Date().toISOString();
    const statements = decisions.map((item) => this.db.prepare(`
      INSERT INTO hero_decisions (
        id, run_id, opportunity_id, duplicate_key, strategy, market_key, selected,
        requested_capital, allocated_capital, reasons_json, score, decided_at, payload_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
      ON CONFLICT(id) DO UPDATE SET selected = excluded.selected, allocated_capital = excluded.allocated_capital,
        reasons_json = excluded.reasons_json, decided_at = excluded.decided_at, payload_json = excluded.payload_json
    `).bind(
      `${runId}:${item.id}`, runId, String(item.id), item.duplicateKey, item.strategy, item.marketKey,
      item.selected ? 1 : 0, finite(item.requestedCapital, 0), finite(item.allocatedCapital, 0),
      JSON.stringify(item.reasons ?? []), finite(item.score, 0), now, JSON.stringify(item)
    ));
    await this.db.batch(statements);
  }

  async executedKeys() {
    const rows = await this.db.prepare("SELECT duplicate_key FROM hosted_executions WHERE applied = 1").all();
    return (rows.results ?? []).map((row) => row.duplicate_key).filter(Boolean);
  }

  async hasExecution(id) {
    const row = await this.db.prepare("SELECT id FROM hosted_executions WHERE id = ?1").bind(String(id)).first();
    return Boolean(row);
  }

  async recordExecution(runId, decision, execution) {
    const status = String(execution.status ?? "ERROR");
    const applied = !["REJECTED", "FAILED", "ERROR", "DUPLICATE_SKIPPED"].includes(status);
    const cashDelta = applied ? finite(execution.cashDelta, 0) : 0;
    const realized = applied ? finite(execution.guaranteedProfit, 0) : 0;
    const executedAt = execution.executedAt ?? new Date().toISOString();
    const statements = [
      this.db.prepare(`
        INSERT INTO hosted_executions (
          id, run_id, opportunity_id, duplicate_key, strategy, market_key, status,
          detected_at, executed_at, capital_required, cash_delta, realized_pnl,
          applied, reasons_json, payload_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
        ON CONFLICT(id) DO NOTHING
      `).bind(
        String(execution.id), runId, String(decision.id), decision.duplicateKey, decision.strategy,
        decision.marketKey, status, execution.detectedAt ?? executedAt, executedAt,
        finite(execution.capitalRequired, decision.allocatedCapital), cashDelta, realized, applied ? 1 : 0,
        JSON.stringify(execution.reasons ?? []), JSON.stringify(execution)
      )
    ];

    if (applied) {
      statements.push(this.db.prepare(`
        UPDATE hosted_portfolio
        SET cash = cash + ?1, realized_pnl = realized_pnl + ?2, updated_at = ?3
        WHERE id = 'paper'
      `).bind(cashDelta, realized, executedAt));
      for (const position of execution.openInventory ?? []) {
        const reducing = position.side === "REDUCE";
        const shares = finite(position.shares, 0) * (reducing ? -1 : 1);
        const cost = finite(position.costBasis, 0) * (reducing ? -1 : 1);
        statements.push(this.db.prepare(`
          INSERT INTO hosted_positions (
            token_id, strategy, market_key, category, side, shares, cost_basis, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
          ON CONFLICT(token_id, strategy, market_key) DO UPDATE SET
            shares = hosted_positions.shares + excluded.shares,
            cost_basis = hosted_positions.cost_basis + excluded.cost_basis,
            side = excluded.side,
            updated_at = excluded.updated_at
        `).bind(
          String(position.tokenId), decision.strategy, decision.marketKey, decision.category ?? "uncategorized",
          position.side ?? "LONG", shares, cost, executedAt
        ));
      }
    }
    await this.db.batch(statements);
    return applied;
  }

  async snapshot(options = {}) {
    const rowLimit = limit(options.limit, 40, 100);
    const [portfolio, executions, opportunities, decisions, signals, run, performance] = await Promise.all([
      this.loadPortfolio(options.startingCash),
      this.db.prepare(`SELECT id, strategy, market_key AS marketKey, status, detected_at AS detectedAt,
        executed_at AS executedAt, capital_required AS capitalRequired, cash_delta AS cashDelta,
        realized_pnl AS realizedPnl, reasons_json AS reasonsJson
        FROM hosted_executions ORDER BY executed_at DESC LIMIT ?1`).bind(rowLimit).all(),
      this.db.prepare(`SELECT id, strategy, market_key AS marketKey, detected_at AS detectedAt,
        question, slug, net_profit AS netProfit, roi_bps AS roiBps,
        capital_required AS capitalRequired, payload_json AS payloadJson
        FROM hosted_opportunities ORDER BY detected_at DESC LIMIT ?1`).bind(rowLimit).all(),
      this.db.prepare(`SELECT id, opportunity_id AS opportunityId, strategy, market_key AS marketKey,
        selected, requested_capital AS requestedCapital, allocated_capital AS allocatedCapital,
        reasons_json AS reasonsJson, score, decided_at AS decidedAt
        FROM hero_decisions ORDER BY decided_at DESC LIMIT ?1`).bind(rowLimit).all(),
      this.db.prepare(`SELECT id, detected_at AS detectedAt, wallet, wallet_name AS walletName,
        effective_wallet_score AS walletScore, category, asset, condition_id AS conditionId,
        title, outcome, detection_delay_seconds AS detectionDelaySeconds, estimated_cost AS estimatedCost,
        slippage_bps AS slippageBps, decision, reasons_json AS reasonsJson
        FROM whale_signals ORDER BY detected_at DESC LIMIT ?1`).bind(rowLimit).all(),
      this.db.prepare("SELECT * FROM hosted_runs ORDER BY started_at DESC LIMIT 1").first(),
      this.db.prepare(`SELECT strategy, COUNT(*) AS executions,
        SUM(CASE WHEN applied = 1 THEN realized_pnl ELSE 0 END) AS realizedPnl,
        SUM(CASE WHEN applied = 1 THEN capital_required ELSE 0 END) AS capitalUsed,
        SUM(CASE WHEN applied = 1 THEN 1 ELSE 0 END) AS appliedExecutions
        FROM hosted_executions GROUP BY strategy ORDER BY strategy`).all()
    ]);

    const parseRows = (rows) => (rows.results ?? []).map((item) => ({
      ...item,
      selected: item.selected === undefined ? undefined : Boolean(item.selected),
      reasons: parseJson(item.reasonsJson, []),
      payload: parseJson(item.payloadJson, null)
    }));
    return {
      portfolio,
      executions: parseRows(executions),
      opportunities: parseRows(opportunities),
      decisions: parseRows(decisions),
      signals: parseRows(signals),
      performance: performance.results ?? [],
      health: run ? {
        runId: run.id,
        status: run.status,
        health: run.health,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        simulationEnabled: Boolean(run.simulation_enabled),
        opportunities: run.opportunities,
        selected: run.selected,
        executions: run.executions,
        errorCount: run.error_count,
        summary: parseJson(run.summary_json, {})
      } : null
    };
  }
}
