import crypto from "node:crypto";

export const TRIAL8_CANONICAL_MANIFEST_PATH = "research/crypto/manifests/bitnomial-carry-v1.json";
export const TRIAL8_CANONICAL_MANIFEST_GIT_BLOB_SHA1 = "3be434dba3c732ee26df471224197466b6b7dbd7";
export const TRIAL8_FINAL_PREOBSERVATION_FREEZE_AT = "2026-08-20T02:08:00Z";

export function gitBlobSha1(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const header = Buffer.from(`blob ${buffer.length}\0`, "utf8");
  return crypto.createHash("sha1").update(header).update(buffer).digest("hex");
}

export function verifyTrial8CanonicalManifestBytes(bytes) {
  const actual = gitBlobSha1(bytes);
  if (actual !== TRIAL8_CANONICAL_MANIFEST_GIT_BLOB_SHA1) {
    throw new Error(`Trial 8 canonical manifest changed after freeze: expected Git blob ${TRIAL8_CANONICAL_MANIFEST_GIT_BLOB_SHA1}, got ${actual}`);
  }
  return actual;
}
