function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rowLimit(value, fallback = 50, maximum = 200) {
  return Math.max(1, Math.min(maximum, Math.trunc(finite(value, fallback))));
}

export class CryptoPaperStore {
  constructor(db) {
    this.db = db;
  }

  async ensureSchema() {
    await this.db.batch([
      this.db.prepare(`CREATE TABLE IF NOT EXISTS crypto_portfolio (
        id TEXT PRIMARY KEY,
        starting_cash REAL NOT NULL,
        cash REAL NOT NULL,
        realized_pnl REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`),
      this.db.prepare(`CREATE TABLE IF NOT EXISTS crypto_positions (
        product_id TEXT PRIMARY KEY,
        units REAL NOT NULL,
        average_cost REAL NOT NULL,
        last_price REAL NOT NULL,
        market_value REAL NOT NULL,
        highest_price REAL NOT NULL,
        opened_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`),
      this.db.prepare(`CREATE TABLE IF NOT EXISTS crypto_signals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        candle_time INTEGER NOT NULL,
        action TEXT NOT NULL,
        score REAL NOT NULL,
        price REAL NOT NULL,
        reasons_json TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`),
      this.db.prepare(`CREATE TABLE IF NOT EXISTS crypto_executions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        signal_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        side TEXT NOT NULL,
        units REAL NOT NULL,
        fill_price REAL NOT NULL,
        notional REAL NOT NULL,
        fee REAL NOT NULL,
        slippage_bps REAL NOT NULL,
        cash_delta REAL NOT NULL,
        realized_pnl REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        reasons_json TEXT NOT NULL,
        executed_at TEXT NOT NULL
      )`),
      this.db.prepare(`CREATE TABLE IF NOT EXISTS crypto_runs (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        simulation_enabled INTEGER NOT NULL,
        products_checked INTEGER NOT NULL DEFAULT 0,
        buy_signals INTEGER NOT NULL DEFAULT 0,
        sell_signals INTEGER NOT NULL DEFAULT 0,
        hold_signals INTEGER NOT NULL DEFAULT 0,
        executions INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        summary_json TEXT NOT NULL DEFAULT '{}'
      )`),
      this.db.prepare("CREATE INDEX IF NOT EXISTS crypto_signals_created_idx ON crypto_signals(created_at DESC)"),
      this.db.prepare("CREATE INDEX IF NOT EXISTS crypto_signals_product_idx ON crypto_signals(product_id, created_at DESC)"),
      this.db.prepare("CREATE INDEX IF NOT EXISTS crypto_executions_time_idx ON crypto_executions(executed_at DESC)"),
      this.db.prepare("CREATE INDEX IF NOT EXISTS crypto_executions_product_idx ON crypto_executions(product_id, executed_at DESC)"),
      this.db.prepare("CREATE INDEX IF NOT EXISTS crypto_runs_started_idx ON crypto_runs(started_at DESC)")
    ]);
  }

  async ensurePortfolio(startingCash = 10_000) {
    await this.ensureSchema();
    const now = new Date().toISOString();
    await this.db.prepare(`
      INSERT INTO crypto_portfolio (id, starting_cash, cash, realized_pnl, updated_at)
      VALUES ('crypto', ?1, ?1, 0, ?2)
      ON CONFLICT(id) DO NOTHING
    `).bind(finite(startingCash, 10_000), now).run();
  }

  async loadPortfolio(startingCash = 10_000) {
    await this.ensurePortfolio(startingCash);
    const [row, positions] = await Promise.all([
      this.db.prepare("SELECT * FROM crypto_portfolio WHERE id = 'crypto'").first(),
      this.db.prepare(`SELECT product_id AS productId, units, average_cost AS averageCost,
        last_price AS lastPrice, market_value AS marketValue, highest_price AS highestPrice,
        opened_at AS openedAt, updated_at AS updatedAt
        FROM crypto_positions ORDER BY market_value DESC`).all()
    ]);
    const list = positions.results ?? [];
    const openPositionValue = list.reduce((sum, item) => sum + Math.max(0, finite(item.marketValue)), 0);
    const cash = finite(row?.cash, startingCash);
    return {
      id: "crypto",
      startingCash: finite(row?.starting_cash, startingCash),
      cash,
      realizedPnl: finite(row?.realized_pnl),
      positions: list,
      openPositionValue,
      equity: cash + openPositionValue,
      updatedAt: row?.updated_at ?? null
    };
  }

  async loadPosition(productId) {
    return this.db.prepare(`SELECT product_id AS productId, units, average_cost AS averageCost,
      last_price AS lastPrice, market_value AS marketValue, highest_price AS highestPrice,
      opened_at AS openedAt, updated_at AS updatedAt
      FROM crypto_positions WHERE product_id = ?1`).bind(String(productId)).first();
  }

  async loadLastExit(productId) {
    return this.db.prepare(`SELECT id, product_id AS productId, realized_pnl AS realizedPnl,
      executed_at AS executedAt FROM crypto_executions
      WHERE product_id = ?1 AND side = 'SELL' AND status = 'FILLED'
      ORDER BY executed_at DESC LIMIT 1`).bind(String(productId)).first();
  }

  async updateMark(productId, price) {
    const value = finite(price);
    if (value <= 0) return;
    await this.db.prepare(`UPDATE crypto_positions
      SET last_price = ?2, market_value = units * ?2,
          highest_price = MAX(highest_price, ?2), updated_at = ?3
      WHERE product_id = ?1`).bind(String(productId), value, new Date().toISOString()).run();
  }

  async startRun({ id, enabled }) {
    const now = new Date().toISOString();
    await this.ensureSchema();
    await this.db.prepare(`INSERT INTO crypto_runs (id, started_at, status, simulation_enabled)
      VALUES (?1, ?2, 'RUNNING', ?3)`).bind(String(id), now, enabled ? 1 : 0).run();
    return now;
  }

  async finishRun(id, summary) {
    const now = new Date().toISOString();
    await this.db.prepare(`UPDATE crypto_runs SET finished_at = ?2, status = ?3,
      products_checked = ?4, buy_signals = ?5, sell_signals = ?6, hold_signals = ?7,
      executions = ?8, error_count = ?9, summary_json = ?10 WHERE id = ?1`).bind(
      String(id), now, summary.status ?? "HEALTHY", finite(summary.productsChecked),
      finite(summary.buySignals), finite(summary.sellSignals), finite(summary.holdSignals),
      finite(summary.executions), Array.isArray(summary.errors) ? summary.errors.length : finite(summary.errorCount),
      JSON.stringify(summary)
    ).run();
    return now;
  }

  async recordSignal(runId, signal) {
    const id = `${signal.productId}:${Math.trunc(finite(signal.candleTime))}`;
    const now = new Date().toISOString();
    await this.db.prepare(`INSERT INTO crypto_signals (
      id, run_id, product_id, candle_time, action, score, price, reasons_json, metrics_json, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id, action = excluded.action,
      score = excluded.score, price = excluded.price, reasons_json = excluded.reasons_json,
      metrics_json = excluded.metrics_json, created_at = excluded.created_at`).bind(
      id, String(runId), String(signal.productId), Math.trunc(finite(signal.candleTime)),
      String(signal.action), finite(signal.score), finite(signal.price), JSON.stringify(signal.reasons ?? []),
      JSON.stringify(signal.metrics ?? {}), now
    ).run();
    return id;
  }

  async hasExecution(id) {
    const row = await this.db.prepare("SELECT id FROM crypto_executions WHERE id = ?1").bind(String(id)).first();
    return Boolean(row);
  }

  async executeBuy({ runId, signalId, productId, notional, fillPrice, feeBps, slippageBps, reasons = [] }) {
    const id = `${signalId}:BUY`;
    if (await this.hasExecution(id)) return { id, status: "DUPLICATE_SKIPPED", applied: false };
    const portfolio = await this.loadPortfolio();
    const safeNotional = Math.max(0, Math.min(finite(notional), portfolio.cash));
    const fee = safeNotional * finite(feeBps) / 10_000;
    const totalCost = safeNotional + fee;
    if (safeNotional <= 0 || fillPrice <= 0 || totalCost > portfolio.cash) {
      return { id, status: "REJECTED", applied: false, reasons: ["insufficient-cash-or-invalid-fill"] };
    }
    const units = safeNotional / fillPrice;
    const now = new Date().toISOString();
    const existing = await this.loadPosition(productId);
    const oldUnits = finite(existing?.units);
    const oldCost = oldUnits * finite(existing?.averageCost);
    const newUnits = oldUnits + units;
    const averageCost = newUnits > 0 ? (oldCost + totalCost) / newUnits : fillPrice;
    await this.db.batch([
      this.db.prepare(`UPDATE crypto_portfolio SET cash = cash - ?1, updated_at = ?2 WHERE id = 'crypto'`)
        .bind(totalCost, now),
      this.db.prepare(`INSERT INTO crypto_positions (
        product_id, units, average_cost, last_price, market_value, highest_price, opened_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?6, ?6)
      ON CONFLICT(product_id) DO UPDATE SET units = excluded.units,
        average_cost = excluded.average_cost, last_price = excluded.last_price,
        market_value = excluded.market_value, highest_price = MAX(crypto_positions.highest_price, excluded.highest_price),
        updated_at = excluded.updated_at`).bind(
        String(productId), newUnits, averageCost, fillPrice, newUnits * fillPrice,
        existing?.openedAt ?? now
      ),
      this.db.prepare(`INSERT INTO crypto_executions (
        id, run_id, signal_id, product_id, side, units, fill_price, notional, fee,
        slippage_bps, cash_delta, realized_pnl, status, reasons_json, executed_at
      ) VALUES (?1, ?2, ?3, ?4, 'BUY', ?5, ?6, ?7, ?8, ?9, ?10, 0, 'FILLED', ?11, ?12)`)
        .bind(id, String(runId), String(signalId), String(productId), units, fillPrice, safeNotional,
          fee, finite(slippageBps), -totalCost, JSON.stringify(reasons), now)
    ]);
    return { id, status: "FILLED", applied: true, side: "BUY", units, fillPrice, notional: safeNotional, fee, cashDelta: -totalCost, realizedPnl: 0 };
  }

  async executeSell({ runId, signalId, productId, fillPrice, feeBps, slippageBps, reasons = [] }) {
    const id = `${signalId}:SELL`;
    if (await this.hasExecution(id)) return { id, status: "DUPLICATE_SKIPPED", applied: false };
    const position = await this.loadPosition(productId);
    const units = finite(position?.units);
    if (units <= 0 || fillPrice <= 0) {
      return { id, status: "REJECTED", applied: false, reasons: ["no-position-or-invalid-fill"] };
    }
    const gross = units * fillPrice;
    const fee = gross * finite(feeBps) / 10_000;
    const proceeds = gross - fee;
    const realized = proceeds - units * finite(position.averageCost);
    const now = new Date().toISOString();
    await this.db.batch([
      this.db.prepare(`UPDATE crypto_portfolio SET cash = cash + ?1,
        realized_pnl = realized_pnl + ?2, updated_at = ?3 WHERE id = 'crypto'`)
        .bind(proceeds, realized, now),
      this.db.prepare("DELETE FROM crypto_positions WHERE product_id = ?1").bind(String(productId)),
      this.db.prepare(`INSERT INTO crypto_executions (
        id, run_id, signal_id, product_id, side, units, fill_price, notional, fee,
        slippage_bps, cash_delta, realized_pnl, status, reasons_json, executed_at
      ) VALUES (?1, ?2, ?3, ?4, 'SELL', ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'FILLED', ?12, ?13)`)
        .bind(id, String(runId), String(signalId), String(productId), units, fillPrice, gross,
          fee, finite(slippageBps), proceeds, realized, JSON.stringify(reasons), now)
    ]);
    return { id, status: "FILLED", applied: true, side: "SELL", units, fillPrice, notional: gross, fee, cashDelta: proceeds, realizedPnl: realized };
  }

  async performanceSummary() {
    await this.ensureSchema();
    const row = await this.db.prepare(`SELECT
      COUNT(*) AS execution_count,
      COALESCE(SUM(fee), 0) AS total_fees,
      COALESCE(SUM(CASE WHEN side = 'SELL' THEN 1 ELSE 0 END), 0) AS closed_trades,
      COALESCE(SUM(CASE WHEN side = 'SELL' AND realized_pnl > 0 THEN 1 ELSE 0 END), 0) AS winners,
      COALESCE(SUM(CASE WHEN side = 'SELL' AND realized_pnl < 0 THEN 1 ELSE 0 END), 0) AS losers,
      COALESCE(SUM(CASE WHEN side = 'SELL' THEN realized_pnl ELSE 0 END), 0) AS realized_pnl,
      COALESCE(AVG(CASE WHEN side = 'SELL' THEN realized_pnl END), 0) AS average_closed_pnl,
      COALESCE(MAX(CASE WHEN side = 'SELL' THEN realized_pnl END), 0) AS best_trade,
      COALESCE(MIN(CASE WHEN side = 'SELL' THEN realized_pnl END), 0) AS worst_trade
      FROM crypto_executions WHERE status = 'FILLED'`).first();
    const closedTrades = finite(row?.closed_trades);
    const winners = finite(row?.winners);
    return {
      executionCount: finite(row?.execution_count),
      totalFees: finite(row?.total_fees),
      closedTrades,
      winners,
      losers: finite(row?.losers),
      winRate: closedTrades > 0 ? winners / closedTrades : 0,
      realizedPnl: finite(row?.realized_pnl),
      averageClosedPnl: finite(row?.average_closed_pnl),
      bestTrade: finite(row?.best_trade),
      worstTrade: finite(row?.worst_trade)
    };
  }

  async snapshot(options = {}) {
    const limit = rowLimit(options.limit, 50, 100);
    const historyLimit = rowLimit(options.historyLimit, 96, 200);
    const startingCash = finite(options.startingCash, 10_000);
    const [portfolio, signals, executions, run, historyRows, performance] = await Promise.all([
      this.loadPortfolio(startingCash),
      this.db.prepare(`SELECT id, run_id AS runId, product_id AS productId, candle_time AS candleTime,
        action, score, price, reasons_json AS reasonsJson, metrics_json AS metricsJson, created_at AS createdAt
        FROM crypto_signals ORDER BY created_at DESC LIMIT ?1`).bind(limit).all(),
      this.db.prepare(`SELECT id, run_id AS runId, signal_id AS signalId, product_id AS productId,
        side, units, fill_price AS fillPrice, notional, fee, slippage_bps AS slippageBps,
        cash_delta AS cashDelta, realized_pnl AS realizedPnl, status,
        reasons_json AS reasonsJson, executed_at AS executedAt
        FROM crypto_executions ORDER BY executed_at DESC LIMIT ?1`).bind(limit).all(),
      this.db.prepare("SELECT * FROM crypto_runs ORDER BY started_at DESC LIMIT 1").first(),
      this.db.prepare(`SELECT started_at AS startedAt, finished_at AS finishedAt, summary_json AS summaryJson
        FROM crypto_runs WHERE finished_at IS NOT NULL ORDER BY started_at DESC LIMIT ?1`).bind(historyLimit).all(),
      this.performanceSummary()
    ]);
    const parseRows = (rows) => (rows.results ?? []).map((item) => ({
      ...item,
      reasons: parseJson(item.reasonsJson, []),
      metrics: parseJson(item.metricsJson, {})
    }));
    const history = (historyRows.results ?? []).map((item) => {
      const summary = parseJson(item.summaryJson, {});
      return {
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        equity: finite(summary.portfolio?.equity, NaN),
        cash: finite(summary.portfolio?.cash, NaN),
        openPositionValue: finite(summary.portfolio?.openPositionValue, NaN),
        realizedPnl: finite(summary.portfolio?.realizedPnl, NaN)
      };
    }).filter((item) => Number.isFinite(item.equity)).reverse();
    return {
      portfolio,
      signals: parseRows(signals),
      executions: parseRows(executions),
      performance,
      history,
      health: run ? {
        runId: run.id,
        status: run.status,
        simulationEnabled: Boolean(run.simulation_enabled),
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        productsChecked: run.products_checked,
        buySignals: run.buy_signals,
        sellSignals: run.sell_signals,
        holdSignals: run.hold_signals,
        executions: run.executions,
        errorCount: run.error_count,
        summary: parseJson(run.summary_json, {})
      } : null
    };
  }
}
