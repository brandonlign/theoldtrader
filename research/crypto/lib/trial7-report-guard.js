const SCREENING_CLASSIFICATIONS = new Set([
  "SCREENING_PASS_NO_PROMOTION",
  "SCREENING_FAIL_NO_PROMOTION",
  "FAILED_DATA_GATE"
]);
const FINAL_CLASSIFICATIONS = new Set([
  "PROMOTION_ELIGIBLE_RESEARCH_ONLY",
  "FAILED_FINAL_GATE",
  "FAILED_DATA_GATE"
]);

function scheduleAudit(result) {
  return result?.dataGate?.binanceFundingScheduleAudit
    ?? result?.provenance?.binanceFundingScheduleAudit
    ?? null;
}

export function validateTrial7ReportArtifact(result) {
  if (result?.experimentId !== "cross-venue-funding-v1" || result?.trialNumber !== 7) {
    throw new Error("Unexpected Trial 7 report artifact identity");
  }
  if (result.paperOnly !== true || result.livePromotionAllowed !== false) {
    throw new Error("Trial 7 report artifact must remain paper-only and non-live");
  }
  if (!["screening", "final"].includes(result.mode)) {
    throw new Error(`Unexpected Trial 7 report mode: ${result.mode}`);
  }
  const allowed = result.mode === "screening" ? SCREENING_CLASSIFICATIONS : FINAL_CLASSIFICATIONS;
  if (!allowed.has(result.classification)) {
    throw new Error(`Forbidden Trial 7 classification in report artifact: ${result.classification}`);
  }
  const audit = scheduleAudit(result);
  if (!audit || typeof audit.pass !== "boolean") {
    throw new Error("Trial 7 report artifact is missing the Binance funding schedule audit");
  }
  if (result.classification !== "FAILED_DATA_GATE" && audit.pass !== true) {
    throw new Error("A non-data-failure Trial 7 report cannot contain a failed Binance funding schedule audit");
  }
  return { pass: true, scheduleAudit: audit };
}

export function binanceFundingScheduleCsv(audit) {
  const rows = [
    ["metric", "value"],
    ["pass", audit.pass],
    ["source_mechanism", audit.sourceMechanism ?? ""],
    ["context_rows", audit.contextRows ?? 0],
    ["event_rows_seen", audit.eventRowsSeen ?? 0],
    ["announced_funding_times", audit.announcedFundingTimes?.length ?? 0],
    ["observed_funding_times", audit.observedFundingTimes?.length ?? 0],
    ["missing_announced_events", audit.missingAnnouncedEvents?.length ?? 0],
    ["unannounced_observed_events", audit.unannouncedObservedEvents?.length ?? 0],
    ["stale_schedule_rows", audit.staleScheduleRows?.length ?? 0]
  ];
  const cell = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `${rows.map((row) => row.map(cell).join(",")).join("\n")}\n`;
}
