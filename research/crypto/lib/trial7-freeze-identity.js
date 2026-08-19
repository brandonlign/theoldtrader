import crypto from "node:crypto";

export const TRIAL7_CANONICAL_MANIFEST_PATH = "research/crypto/manifests/cross-venue-funding-v1.json";
export const TRIAL7_CANONICAL_MANIFEST_GIT_BLOB_SHA1 = "d01224c1fb79a6bffff7a5ad72d9d7bd35dded21";
export const TRIAL7_FINAL_IMPLEMENTATION_FREEZE_AT = "2026-08-19T23:04:02Z";

export function gitBlobSha1(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const header = Buffer.from(`blob ${buffer.length}\0`, "utf8");
  return crypto.createHash("sha1").update(header).update(buffer).digest("hex");
}

export function verifyTrial7CanonicalManifestBytes(bytes) {
  const actual = gitBlobSha1(bytes);
  if (actual !== TRIAL7_CANONICAL_MANIFEST_GIT_BLOB_SHA1) {
    throw new Error(
      `Trial 7 canonical manifest bytes changed after freeze: expected Git blob ${TRIAL7_CANONICAL_MANIFEST_GIT_BLOB_SHA1}, got ${actual}`
    );
  }
  return actual;
}
