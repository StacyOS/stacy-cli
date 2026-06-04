import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalBytes } from "../crypto/canonical.js";
import { sha256Hex } from "../util/hash.js";
import type { AdapterRunResult } from "./adapters.js";

export interface RunCacheKeyInput {
  readonly task: string;
  readonly model: string;
  readonly adapter: string;
  readonly inputContentHashes: readonly string[];
}

/**
 * Deterministic cache key for an AI run. Input content hashes are sorted so the
 * order of `--use` flags does not affect the key — the same inputs always map
 * to the same cached result.
 */
export function computeRunCacheKey(input: RunCacheKeyInput): string {
  return sha256Hex(
    canonicalBytes({
      task: input.task,
      model: input.model,
      adapter: input.adapter,
      inputContentHashes: [...input.inputContentHashes].sort(),
    }),
  );
}

export interface RunCache {
  get(key: string): Promise<AdapterRunResult | undefined>;
  set(key: string, value: AdapterRunResult): Promise<void>;
}

interface CacheEnvelope {
  readonly schemaVersion: 1;
  readonly result: AdapterRunResult;
}

/**
 * File-backed run cache. Each entry is a small JSON file under the instance's
 * `runs/cache` directory, named by the run cache key. Lets repeated runs with
 * identical inputs skip the (billable) adapter call.
 */
export class FileRunCache implements RunCache {
  constructor(private readonly dir: string) {}

  async get(key: string): Promise<AdapterRunResult | undefined> {
    try {
      const raw = await readFile(this.pathFor(key), "utf8");
      const parsed = JSON.parse(raw) as Partial<CacheEnvelope>;
      if (parsed.schemaVersion !== 1 || typeof parsed.result !== "object" || parsed.result === null) {
        return undefined;
      }
      return parsed.result;
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
  }

  async set(key: string, value: AdapterRunResult): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const envelope: CacheEnvelope = { schemaVersion: 1, result: value };
    await writeFile(this.pathFor(key), `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
  }

  private pathFor(key: string): string {
    return join(this.dir, `${key}.json`);
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
