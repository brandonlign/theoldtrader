export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const baseUrl = process.env.THEOLDTRADER_WORKER_URL;
  const token = process.env.THEOLDTRADER_WORKER_API_TOKEN;
  if (!baseUrl || !token) {
    return Response.json({ configured: false, signals: [] }, {
      headers: { "cache-control": "no-store" }
    });
  }
  try {
    const requestUrl = new URL(request.url);
    const url = new URL("/api/whales", baseUrl);
    url.searchParams.set("limit", requestUrl.searchParams.get("limit") ?? "100");
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const payload = await response.json();
    return Response.json({ configured: true, ...payload }, {
      status: response.ok ? 200 : response.status,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return Response.json({
      configured: true,
      signals: [],
      error: error instanceof Error ? error.message : "Worker signals failed."
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
