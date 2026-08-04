import worker, { runHostedCycle } from "./worker.js";
import { HostedPaperStore } from "./hosted-store.js";

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

async function runWithLease(env) {
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

  try {
    return await runHostedCycle(env);
  } finally {
    await store.releaseCycleLock(owner);
  }
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runWithLease(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/run" && request.method === "POST") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      return json(await runWithLease(env));
    }
    return worker.fetch(request, env, ctx);
  }
};
