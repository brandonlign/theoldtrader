#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { buildCrossVenueFundingReport } from "./lib/cross-venue-funding-report.js";
import {
  binanceFundingScheduleCsv,
  validateTrial7ReportArtifact
} from "./lib/trial7-report-guard.js";

const [resultPath, outputDir] = process.argv.slice(2);
if (!resultPath || !outputDir) {
  throw new Error("Usage: node research/crypto/cross-venue-funding-report.mjs <evaluation.json> <new-output-dir>");
}
if (fs.existsSync(outputDir)) {
  throw new Error(`Refusing to overwrite existing Trial 7 report directory: ${outputDir}`);
}
const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const guarded = validateTrial7ReportArtifact(result);
const files = buildCrossVenueFundingReport(result);
files["binance-funding-schedule.csv"] = binanceFundingScheduleCsv(guarded.scheduleAudit);
files["REPORT.md"] = `${files["REPORT.md"].trimEnd()}\n\n## Binance settled-funding schedule audit\n\n- Gate: **${guarded.scheduleAudit.pass ? "PASS" : "FAIL"}**\n- Mechanism: ${guarded.scheduleAudit.sourceMechanism ?? "n/a"}\n- Announced in-window funding times: ${guarded.scheduleAudit.announcedFundingTimes?.length ?? 0}\n- Settled in-window funding times observed: ${guarded.scheduleAudit.observedFundingTimes?.length ?? 0}\n- Missing announced events: ${guarded.scheduleAudit.missingAnnouncedEvents?.length ?? 0}\n- Stale next-funding schedule rows: ${guarded.scheduleAudit.staleScheduleRows?.length ?? 0}\n\n`;

fs.mkdirSync(outputDir, { recursive: false });
for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(outputDir, name), content, { flag: "wx" });
}
process.stdout.write(`${JSON.stringify({
  input: resultPath,
  outputDir,
  classification: result.classification,
  binanceFundingSchedulePass: guarded.scheduleAudit.pass,
  files: Object.keys(files).sort()
}, null, 2)}\n`);
