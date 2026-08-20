#!/usr/bin/env node

import fs from "node:fs";
import {
  TRIAL8_CANONICAL_MANIFEST_GIT_BLOB_SHA1,
  TRIAL8_CANONICAL_MANIFEST_PATH,
  TRIAL8_FINAL_PREOBSERVATION_FREEZE_AT,
  verifyTrial8CanonicalManifestBytes
} from "./lib/trial8-freeze-identity.js";

const bytes = fs.readFileSync(TRIAL8_CANONICAL_MANIFEST_PATH);
const blob = verifyTrial8CanonicalManifestBytes(bytes);
const manifest = JSON.parse(bytes.toString("utf8"));
if (manifest.experimentId !== "bitnomial-carry-v1" || manifest.trialNumber !== 8) throw new Error("Unexpected Trial 8 manifest identity");
if (manifest.paperOnly !== true || manifest.livePromotionAllowed !== false || manifest.scientificMode !== "forward-only") throw new Error("Trial 8 safety flags changed");
process.stdout.write(`${JSON.stringify({ status: "PASS", experimentId: manifest.experimentId, trialNumber: 8, manifestGitBlobSha1: blob, expectedGitBlobSha1: TRIAL8_CANONICAL_MANIFEST_GIT_BLOB_SHA1, frozenAt: TRIAL8_FINAL_PREOBSERVATION_FREEZE_AT })}\n`);
