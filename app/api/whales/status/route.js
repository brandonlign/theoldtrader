export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const baseUrl = process.env.THEOLDTRADER_WORKER_URL;
  if (!baseUrl) {
    return Response.json({ configured: false, enabled: false, message: "Free worker not connected yet." }, {
      headers: { "cache-control": "no-store" }
    });
  }
  try {
    const response = await fetch(new URL("/health", baseUrl), { cache: "no-store" });
    const payload = await response.json();
    return Response.json({ configured: true, ...payload }, {
      status: response.ok ? 200 : 502,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return Response.json({
      configured: true,
      enabled: false,
      error: error instanceof Error ? error.message : "Worker status failed."
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
