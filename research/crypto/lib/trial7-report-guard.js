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

function settlementProjection(result) {
  return result?.dataGate?.settlementDiscoveryProjection
    ?? result?.provenance?.settlementDiscoveryProjection
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

  const schedule = scheduleAudit(result);
  const settlement = settlementProjection(result);
  const failedDataGate = result.classification === "FAILED_DATA_GATE";

  if (failedDataGate) {
    if (result.economicsCalculated !== false || result?.dataGate?.pass !== false) {
      throw new Error("FAILED_DATA_GATE Trial 7 report artifact must contain no economics and a failed data gate");
    }
    if (settlement?.postWindowMarketFieldsUsed === true) {
      throw new Error("Trial 7 report artifact cannot use post-window market fields during settlement discovery");
    }
    return { pass: true, scheduleAudit: schedule, settlementProjection: settlement };
  }

  if (result.economicsCalculated !== true || result?.dataGate?.pass !== true) {
    throw new Error("A non-data-failure Trial 7 report requires calculated economics and a passing data gate");
  }
  if (result?.provenance?.rawSemanticAudit?.pass !== true) {
    throw new Error("A non-data-failure Trial 7 report requires a passing independent raw semantic audit");
  }
  if (result?.provenance?.hyperliquidFundingTimestampNormalization?.pass !== true) {
    throw new Error("A non-data-failure Trial 7 report requires passing Hyperliquid funding timestamp normalization");
  }
  if (!schedule || schedule.pass !== true) {
    throw new Error("A non-data-failure Trial 7 report requires a passing Binance funding schedule audit");
  }
  if (!settlement || settlement.pass !== true) {
    throw new Error("A non-data-failure Trial 7 report requires a passing settlement-discovery projection audit");
  }
  if (settlement.postWindowMarketFieldsUsed !== false) {
    throw new Error("Trial 7 report artifact cannot use post-window market fields during settlement discovery");
  }

  return { pass: true, scheduleAudit: schedule, settlementProjection: settlement };
}

export function binanceFundingScheduleCsv(audit) {
  if (!audit) {
    return "metric,value\nstatus,not_reached_before_data_failure\n";
  }
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
