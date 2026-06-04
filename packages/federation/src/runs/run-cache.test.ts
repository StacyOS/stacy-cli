import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileRunCache, computeRunCacheKey } from "./run-cache.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("computeRunCacheKey", () => {
  it("is independent of input content hash order", () => {
    const a = computeRunCacheKey({
      task: "summarize",
      model: "claude-sonnet-4-5",
      adapter: "deterministic",
      inputContentHashes: ["sha256:aaa", "sha256:bbb"],
    });
    const b = computeRunCacheKey({
      task: "summarize",
      model: "claude-sonnet-4-5",
      adapter: "deterministic",
      inputContentHashes: ["sha256:bbb", "sha256:aaa"],
    });
    expect(a).toBe(b);
  });

  it("changes when the task changes", () => {
    const base = {
      model: "claude-sonnet-4-5",
      adapter: "deterministic",
      inputContentHashes: ["sha256:aaa"],
    };
    expect(computeRunCacheKey({ ...base, task: "one" })).not.toBe(
      computeRunCacheKey({ ...base, task: "two" }),
    );
  });
});

describe("FileRunCache", () => {
  it("round-trips a stored result and misses unknown keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stacy-run-cache-"));
    tempDirs.push(dir);
    const cache = new FileRunCache(dir);

    expect(await cache.get("missing")).toBeUndefined();

    await cache.set("key1", { output: { kind: "report", value: 7 }, notes: ["ok"] });
    expect(await cache.get("key1")).toEqual({ output: { kind: "report", value: 7 }, notes: ["ok"] });
  });
});
