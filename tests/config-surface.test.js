import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../src/config.js";

const ALLOWED_ENV = [
  "THEOLDTRADER_WORKER_API_TOKEN",
  "THEOLDTRADER_WORKER_URL"
];

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(fullPath));
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

test("app-level environment surface is exactly two Worker connection variables", async () => {
  const found = new Set();
  for (const root of ["app", "src"]) {
    for (const file of await sourceFiles(root)) {
      const text = await readFile(file, "utf8");
      for (const match of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) found.add(match[1]);
    }
  }
  assert.deepEqual([...found].sort(), ALLOWED_ENV);
});

test("env example exposes only the two server-side Worker settings", async () => {
  const text = await readFile(".env.example", "utf8");
  const names = text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=", 1)[0])
    .sort();
  assert.deepEqual(names, ALLOWED_ENV);
});

test("local paper mode is explicit rather than environment-controlled", () => {
  assert.equal(loadConfig().paperEnabled, false);
  assert.equal(loadConfig({ paperEnabled: true }).paperEnabled, true);
  assert.equal(loadConfig().maxMarkets, 500);
  assert.equal(loadConfig().paperStatePath, ".theoldtrader/paper-state.json");
});
