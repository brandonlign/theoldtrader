#!/usr/bin/env node

import fs from "node:fs";
import {
  TRIAL7_CANONICAL_MANIFEST_GIT_BLOB_SHA1,
  TRIAL7_CANONICAL_MANIFEST_PATH,
  TRIAL7_FINAL_IMPLEMENTATION_FREEZE_AT,
  verifyTrial7CanonicalManifestBytes
} from "./lib/trial7-freeze-identity.js";

const bytes = fs.readFileSync(TRIAL7_CANONICAL_MANIFEST_PATH);
const blob = verifyTrial7CanonicalManifestBytes(bytes);
const manifest = JSON.parse(bytes.toString("utf8"));
if (manifest.experimentId !== "cross-venue-funding-v1" || manifest.trialNumber !== 7) {
  throw new Error("Unexpected Trial 7 canonical manifest identity");
}
if (manifest.freeze?.finalImplementationFreezeAt !== TRIAL7_FINAL_IMPLEMENTATION_FREEZE_AT) {
  throw new Error("Trial 7 final implementation freeze timestamp does not match the pinned identity");
}
if (manifest.paperOnly !== true || manifest.livePromotionAllowed !== false) {
  throw new Error("Pinned Trial 7 manifest no longer has paper-only/non-live safety flags");
}
process.stdout.write(`${JSON.stringify({
  status: "PASS",
  manifestPath: TRIAL7_CANONICAL_MANIFEST_PATH,
  gitBlobSha1: blob,
  expectedGitBlobSha1: TRIAL7_CANONICAL_MANIFEST_GIT_BLOB_SHA1,
  finalImplementationFreezeAt: TRIAL7_FINAL_IMPLEMENTATION_FREEZE_AT
})}\n`);
