export default function HomePage() {
  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "72px 24px 96px" }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.6 }}>
        TheOldTrader Research
      </p>
      <h1 style={{ margin: "14px 0 16px", fontSize: "clamp(36px, 7vw, 68px)", lineHeight: 0.98, letterSpacing: "-0.045em" }}>
        Flagship research in progress.
      </h1>
      <p style={{ maxWidth: 700, margin: 0, fontSize: 18, lineHeight: 1.6, opacity: 0.72 }}>
        The legacy Polymarket desk and directional crypto paper strategy have been retired from the public dashboard. They did not earn flagship status. Current candidates remain research-only until they pass their frozen validation gates.
      </p>
      <section style={{ marginTop: 44, paddingTop: 28, borderTop: "1px solid rgba(127,127,127,.28)" }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 22 }}>Current status</h2>
        <p style={{ margin: 0, lineHeight: 1.65, opacity: 0.72 }}>
          Trial 8 is collecting sealed prospective evidence for a market-neutral BTC spot/perpetual carry candidate. Its candidate returns are intentionally not exposed during the sealed window. Additional flagship methods are being developed independently in parallel.
        </p>
      </section>
    </main>
  );
}
