#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { buildCrossVenueFundingReport } from "./lib/cross-venue-funding-report.js";

const [resultPath, outputDir] = process.argv.slice(2);
if (!resultPath || !outputDir) {
  throw new Error("Usage: node research/crypto/cross-venue-funding-report.mjs <evaluation.json> <new-output-dir>");
}
if (fs.existsSync(outputDir)) {
  throw new Error(`Refusing to overwrite existing Trial 7 report directory: ${outputDir}`);
}
const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const files = buildCrossVenueFundingReport(result);
fs.mkdirSync(outputDir, { recursive: false });
for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(outputDir, name), content, { flag: "wx" });
}
process.stdout.write(`${JSON.stringify({
  input: resultPath,
  outputDir,
  classification: result.classification,
  files: Object.keys(files).sort()
}, null, 2)}\n`);
