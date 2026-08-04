import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defaultPaperPortfolio } from "./portfolio.js";

export class JsonPaperStore {
  constructor(path, startingCash = 10_000) {
    this.path = path;
    this.startingCash = startingCash;
  }

  async load() {
    try {
      return JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return defaultPaperPortfolio(this.startingCash);
      throw error;
    }
  }

  async save(state) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(state, null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.path);
  }
}
