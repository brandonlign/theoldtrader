import worker, { runHostedCycle } from "./worker.js";
import { runCryptoCycle } from "./crypto-engine.js";
import { CryptoPaperStore } from "./crypto-store.js";
import { HostedPaperStore } from "./hosted-store.js";
import { normalizedCryptoCadenceMinutes, shouldRunCryptoAt } from "../src/crypto/cadence.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function authorized(request, env) {
  if (!env.API_TOKEN) return false;
  return (request.headers.get("authorization") ?? "") === `Bearer ${env.API_TOKEN}`;
}

function failedDesk(name, reason) {
  return {
    status: "UNHEALTHY",
    health: "UNHEALTHY",
    desk: name,
    errors: [reason instanceof Error ? reason.message : String(reason)]
  };
}

function skippedCryptoDesk(cadenceMinutes) {
  return {
    status: "SKIPPED",
    health: "HEALTHY",
    desk: "crypto",
    skipped: true,
    reason: `crypto-${cadenceMinutes}m-cadence`,
    productsChecked: 0,
    executions: 0,
    errors: []
  };
}

async function runWithLease(env, options = {}) {
  const store = new HostedPaperStore(env.DB);
  const owner = crypto.randomUUID();
  const acquired = await store.acquireCycleLock(owner, finite(env.CYCLE_LOCK_TTL_MS, 240_000));
  if (!acquired) {
    return {
      runId: owner,
      status: "SKIPPED",
      health: "DEGRADED",
      reason: "cycle-already-running",
      opportunities: 0,
      selected: 0,
      executions: 0,
      errors: []
    };
  }

  const cryptoCadenceMinutes = normalizedCryptoCadenceMinutes(
    options.cryptoCadenceMinutes ?? env.CRYPTO_CADENCE_MINUTES,
    15
  );
  const runCrypto = options.runCrypto !== false;

  try {
    const [polymarketResult, cryptoResult] = await Promise.allSettled([
      runHostedCycle(env),
      runCrypto
        ? runCryptoCycle(env, { runId: owner })
        : Promise.resolve(skippedCryptoDesk(cryptoCadenceMinutes))
    ]);
    const polymarket = polymarketResult.status === "fulfilled"
      ? polymarketResult.value
      : failedDesk("polymarket", polymarketResult.reason);
    const cryptoDesk = cryptoResult.status === "fulfilled"
      ? cryptoResult.value
      : failedDesk("crypto", cryptoResult.reason);
    const unhealthy = [polymarket, cryptoDesk].some((item) => item.status === "UNHEALTHY");
    const degraded = [polymarket, cryptoDesk].some((item) => item.status === "DEGRADED");
    return {
      ...polymarket,
      status: unhealthy ? "UNHEALTHY" : degraded ? "DEGRADED" : polymarket.status,
      health: unhealthy ? "UNHEALTHY" : degraded ? "DEGRADED" : polymarket.health,
      polymarket,
      crypto: cryptoDesk
    };
  } finally {
    await store.releaseCycleLock(owner);
  }
}

async function combinedSnapshot(request, env, ctx) {
  const response = await worker.fetch(request, env, ctx);
  const payload = await response.json();
  if (!response.ok) return json(payload, response.status);
  const incoming = new URL(request.url);
  const cryptoSnapshot = await new CryptoPaperStore(env.DB).snapshot({
    limit: incoming.searchParams.get("limit"),
    startingCash: finite(env.CRYPTO_STARTING_CASH, 10_000)
  });
  return json({ ...payload, crypto: cryptoSnapshot });
}

export default {
  async scheduled(controller, env, ctx) {
    const cryptoCadenceMinutes = normalizedCryptoCadenceMinutes(env.CRYPTO_CADENCE_MINUTES, 15);
    const runCrypto = shouldRunCryptoAt(controller?.scheduledTime, cryptoCadenceMinutes);
    ctx.waitUntil(runWithLease(env, { runCrypto, cryptoCadenceMinutes }));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/run" && request.method === "POST") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      return json(await runWithLease(env));
    }
    if (url.pathname === "/api/snapshot" && request.method === "GET") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      return combinedSnapshot(request, env, ctx);
    }
    if (url.pathname === "/api/crypto" && request.method === "GET") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      return json(await new CryptoPaperStore(env.DB).snapshot({
        limit: url.searchParams.get("limit"),
        startingCash: finite(env.CRYPTO_STARTING_CASH, 10_000)
      }));
    }
    if (url.pathname === "/api/health" && request.method === "GET") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      const response = await worker.fetch(request, env, ctx);
      const payload = await response.json();
      const cryptoSnapshot = await new CryptoPaperStore(env.DB).snapshot({ limit: 1 });
      return json({ ...payload, crypto: cryptoSnapshot.health });
    }
    return worker.fetch(request, env, ctx);
  }
};
