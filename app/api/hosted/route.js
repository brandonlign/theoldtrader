export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pausedSnapshot(message) {
  return {
    configured: false,
    message,
    portfolio: { startingCash: 10000, cash: 10000, realizedPnl: 0, positions: [], openPositionValue: 0 },
    executions: [], opportunities: [], decisions: [], signals: [], performance: [],
    health: { status: "PAUSED", health: "PAUSED", simulationEnabled: false }
  };
}

export async function GET(request) {
  const baseUrl = process.env.MONEYMOG_WORKER_URL;
  const token = process.env.MONEYMOG_WORKER_API_TOKEN;
  if (!baseUrl || !token) {
    return Response.json(pausedSnapshot("Cloudflare Worker is not connected yet."), {
      headers: { "cache-control": "no-store" }
    });
  }

  try {
    const incoming = new URL(request.url);
    const workerUrl = new URL("/api/snapshot", baseUrl);
    workerUrl.searchParams.set("limit", incoming.searchParams.get("limit") ?? "40");
    const response = await fetch(workerUrl, {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` }
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? `Worker returned ${response.status}`);
    return Response.json({ configured: true, ...payload }, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return Response.json({
      ...pausedSnapshot("The dashboard could not reach the Cloudflare Worker."),
      configured: true,
      health: { status: "DEGRADED", health: "DEGRADED", simulationEnabled: false },
      error: error instanceof Error ? error.message : String(error)
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
