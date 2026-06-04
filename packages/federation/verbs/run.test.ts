import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createInstallIdentity } from "../src/identity/install-identity.js";
import {
  createKnowledgeObject,
  type SignedKnowledgeObject,
} from "../src/ko/knowledge-object.js";
import type { CanonicalJsonValue } from "../src/crypto/canonical.js";
import type { ReadKnowledgeObjectResult } from "../src/brain/brain-store.js";
import { deterministicAdapter, type AdapterRunResult, type RunAdapter } from "../src/runs/adapters.js";
import type { RunCache } from "../src/runs/run-cache.js";
import { agentRunCommand, runChainCommand, runOnce } from "./run.js";
import { resolveLocalRuntime } from "./local-runtime.js";

const tempRoots: string[] = [];
const identity = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));

function inputKo(id: string, content: CanonicalJsonValue): SignedKnowledgeObject {
  return inputKoAt(id, content, new Date("2026-05-21T00:00:00.000Z"));
}

function inputKoAt(id: string, content: CanonicalJsonValue, createdAt: Date): SignedKnowledgeObject {
  return createKnowledgeObject({
    tenant: "stacy/acme",
    contentType: "application/json",
    content,
    identity,
    createdAt,
    idGenerator: () => id,
  });
}

function fakeRead(objects: Map<string, SignedKnowledgeObject>) {
  return async ({ koId }: { koId: string }): Promise<ReadKnowledgeObjectResult> => {
    const ko = objects.get(koId);
    if (!ko) return { ok: false, reason: "Knowledge Object not found" };
    return {
      ok: true,
      ko,
      provenance: {
        source: "local",
        creatorInstallId: ko.signedPayload.creatorInstallId,
        storedAt: "2026-05-21T00:00:00.000Z",
      },
      verification: { contentHash: ko.signedPayload.contentHash },
    };
  };
}

describe("agentRunCommand", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  it("runs the deterministic adapter end-to-end and signs an agent_output KO", async () => {
    const configPath = await writeConfig();
    const lines: string[] = [];
    const queries: unknown[] = [];
    const objects = new Map<string, SignedKnowledgeObject>([
      ["ko_pr_231", inputKo("ko_pr_231", { kind: "github_pull_request", number: 231 })],
      ["ko_pr_232", inputKo("ko_pr_232", { kind: "github_pull_request", number: 232 })],
    ]);

    await agentRunCommand(
      "Create a release risk report",
      {
        config: configPath,
        dbUrl: "postgres://example",
        use: ["ko_pr_231", "ko_pr_232"],
        adapter: "deterministic",
        koId: "ko_agent_output",
        json: true,
      },
      {
        createDb: () => ({
          execute: async (query) => {
            queries.push(query);
            return [];
          },
        }),
        readKnowledgeObject: fakeRead(objects),
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    const summary = JSON.parse(lines[0] ?? "{}") as {
      id: string;
      adapter: string;
      inputKoIds: string[];
      contentHash: string;
    };
    expect(summary).toMatchObject({
      id: "ko_agent_output",
      adapter: "deterministic",
      inputKoIds: ["ko_pr_231", "ko_pr_232"],
    });
    expect(summary.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    // create + sign + run receipts plus the KO insert all issue queries.
    expect(queries.length).toBeGreaterThanOrEqual(4);
  });

  it("reuses a cached adapter result on a second identical run", async () => {
    const objects = new Map<string, SignedKnowledgeObject>([
      ["ko_pr_231", inputKo("ko_pr_231", { kind: "github_pull_request", number: 231 })],
    ]);
    let adapterRuns = 0;
    const countingAdapter: RunAdapter = {
      id: "deterministic",
      deterministic: true,
      run: async () => {
        adapterRuns += 1;
        return { output: { kind: "report", runs: adapterRuns } };
      },
    };
    const store = new Map<string, AdapterRunResult>();
    const cache: RunCache = {
      get: async (key) => store.get(key),
      set: async (key, value) => {
        store.set(key, value);
      },
    };
    const lines: string[] = [];

    const run = () =>
      agentRunCommand(
        "Create a release risk report",
        {
          dbUrl: "postgres://example",
          use: ["ko_pr_231"],
          adapter: "deterministic",
          json: true,
        },
        {
          adapters: new Map([["deterministic", countingAdapter]]),
          createDb: () => ({ execute: async () => [] }),
          readKnowledgeObject: fakeRead(objects),
          cache,
          stdout: { log: (line) => lines.push(line) },
          now: () => new Date("2026-05-22T00:00:00.000Z"),
        },
      );

    await run();
    await run();

    expect(adapterRuns).toBe(1);
    const first = JSON.parse(lines[0] ?? "{}") as { cached: boolean };
    const second = JSON.parse(lines[1] ?? "{}") as { cached: boolean };
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
  });

  it("caches on identical CONTENT even when the input KO id/timestamp differ (chain caching)", async () => {
    // Two KOs with identical content but different createdAt => different KO
    // ids and contentHashes (the KO hash folds in createdAt). A chain's
    // downstream step sees a freshly-created upstream output KO each run, so
    // keying the run cache on the KO hash would miss every time. The cache must
    // key on content instead.
    const content = { kind: "doc", body: "same content" };
    const objects = new Map<string, SignedKnowledgeObject>([
      ["ko_v1", inputKoAt("ko_v1", content, new Date("2026-05-21T00:00:00.000Z"))],
      ["ko_v2", inputKoAt("ko_v2", content, new Date("2026-05-22T12:34:56.000Z"))],
    ]);
    expect(objects.get("ko_v1")!.signedPayload.contentHash).not.toBe(
      objects.get("ko_v2")!.signedPayload.contentHash,
    ); // sanity: different KO content hashes (createdAt differs)

    let adapterRuns = 0;
    const countingAdapter: RunAdapter = {
      id: "deterministic",
      deterministic: true,
      run: async () => {
        adapterRuns += 1;
        return { output: { kind: "report" } };
      },
    };
    const store = new Map<string, AdapterRunResult>();
    const cache: RunCache = {
      get: async (key) => store.get(key),
      set: async (key, value) => {
        store.set(key, value);
      },
    };
    const runWith = (koId: string) =>
      agentRunCommand(
        "Summarize",
        { dbUrl: "postgres://example", use: [koId], adapter: "deterministic", json: true },
        {
          adapters: new Map([["deterministic", countingAdapter]]),
          createDb: () => ({ execute: async () => [] }),
          readKnowledgeObject: fakeRead(objects),
          cache,
          stdout: { log: () => undefined },
          now: () => new Date("2026-05-22T00:00:00.000Z"),
        },
      );

    await runWith("ko_v1");
    await runWith("ko_v2"); // different KO id, same content => must hit cache

    expect(adapterRuns).toBe(1);
  });

  it("skips the cache when noCache is set", async () => {
    const objects = new Map<string, SignedKnowledgeObject>([
      ["ko_pr_231", inputKo("ko_pr_231", { kind: "github_pull_request", number: 231 })],
    ]);
    let adapterRuns = 0;
    const countingAdapter: RunAdapter = {
      id: "deterministic",
      deterministic: true,
      run: async () => {
        adapterRuns += 1;
        return { output: { kind: "report" } };
      },
    };
    let cacheTouched = false;
    const cache: RunCache = {
      get: async () => {
        cacheTouched = true;
        return undefined;
      },
      set: async () => {
        cacheTouched = true;
      },
    };

    await agentRunCommand(
      "report",
      { dbUrl: "postgres://example", use: ["ko_pr_231"], adapter: "deterministic", noCache: true, json: true },
      {
        adapters: new Map([["deterministic", countingAdapter]]),
        createDb: () => ({ execute: async () => [] }),
        readKnowledgeObject: fakeRead(objects),
        cache,
        stdout: { log: () => undefined },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    expect(adapterRuns).toBe(1);
    expect(cacheTouched).toBe(false);
  });

  it("requires --ack-egress for non-deterministic adapters before reading any KO", async () => {
    let dbCreated = false;
    const networkAdapter: RunAdapter = {
      id: "anthropic",
      deterministic: false,
      run: async () => ({ output: { kind: "report" } }),
    };

    await expect(
      agentRunCommand(
        "summarize",
        { dbUrl: "postgres://example", use: ["ko_pr_231"], adapter: "anthropic" },
        {
          adapters: new Map([["anthropic", networkAdapter], ["deterministic", deterministicAdapter]]),
          createDb: () => {
            dbCreated = true;
            return { execute: async () => [] };
          },
          stdout: { log: () => undefined },
        },
      ),
    ).rejects.toThrow("--ack-egress");

    expect(dbCreated).toBe(false);
  });

  it("fails clearly when an input KO does not exist", async () => {
    const configPath = await writeConfig();

    await expect(
      agentRunCommand(
        "report",
        { config: configPath, dbUrl: "postgres://example", use: ["ko_missing"], adapter: "deterministic" },
        {
          createDb: () => ({ execute: async () => [] }),
          readKnowledgeObject: fakeRead(new Map()),
          stdout: { log: () => undefined },
        },
      ),
    ).rejects.toThrow("ko_missing could not be read");
  });

  it("runOnce returns the stored KO id and flips fromCache across calls (chain contract)", async () => {
    const configPath = await writeConfig();
    const runtime = resolveLocalRuntime({ config: configPath, dbUrl: "postgres://example" }, {});
    const objects = new Map<string, SignedKnowledgeObject>([
      ["ko_in", inputKo("ko_in", { kind: "doc", n: 1 })],
    ]);
    const store = new Map<string, AdapterRunResult>();
    const cache: RunCache = {
      get: async (key) => store.get(key),
      set: async (key, value) => {
        store.set(key, value);
      },
    };
    const ctx = {
      db: { execute: async () => [] } as never,
      read: fakeRead(objects),
      cache,
      identityPath: runtime.identityPath,
      now: new Date("2026-05-22T00:00:00.000Z"),
    };
    const params = {
      task: "Summarize",
      model: "claude-sonnet-4-5",
      adapter: deterministicAdapter,
      inputKoIds: ["ko_in"],
    };

    const first = await runOnce(params, ctx);
    const second = await runOnce(params, ctx);

    expect(first.koId).toMatch(/^ko_/);
    expect(first.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    // #7: deterministic content => identical KO id and hash across runs.
    expect(second.koId).toBe(first.koId);
    expect(second.contentHash).toBe(first.contentHash);
  });

  it("runs a 2-step chain, threading @ref from step 1's output into step 2", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-chain-"));
    tempRoots.push(root);
    const configPath = await writeConfig();
    const specPath = join(root, "chain.json");
    await writeFile(
      specPath,
      JSON.stringify({
        steps: [
          { id: "per_doc", task: "Summarize each", use: ["ko_a", "ko_b"] },
          { id: "synthesis", task: "Synthesize one report", use: ["@per_doc"] },
        ],
      }),
      "utf8",
    );

    const seeded = new Map<string, SignedKnowledgeObject>([
      ["ko_a", inputKo("ko_a", { kind: "doc", n: 1 })],
      ["ko_b", inputKo("ko_b", { kind: "doc", n: 2 })],
    ]);
    // Serve seeded inputs; synthesize a valid signed KO for produced step
    // outputs so a later step's @ref read resolves and verifies.
    const read = async ({ koId }: { koId: string }): Promise<ReadKnowledgeObjectResult> => {
      const ko = seeded.get(koId) ?? inputKo(koId, { kind: "produced", id: koId });
      return {
        ok: true,
        ko,
        provenance: { source: "local", creatorInstallId: ko.signedPayload.creatorInstallId, storedAt: "2026-05-21T00:00:00.000Z" },
        verification: { contentHash: ko.signedPayload.contentHash },
      };
    };

    const lines: string[] = [];
    await runChainCommand(
      { config: configPath, dbUrl: "postgres://example", chain: specPath, adapter: "deterministic", json: true },
      {
        createDb: () => ({ execute: async () => [] }),
        readKnowledgeObject: read,
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    const out = JSON.parse(lines[0] ?? "{}") as {
      steps: { id: string; koId: string; inputKoIds: string[] }[];
      finalKoId: string;
    };
    expect(out.steps).toHaveLength(2);
    expect(out.steps[0]?.inputKoIds).toEqual(["ko_a", "ko_b"]);
    // step 2's @per_doc resolved to step 1's produced KO id.
    expect(out.steps[1]?.inputKoIds).toEqual([out.steps[0]?.koId]);
    expect(out.finalKoId).toBe(out.steps[1]?.koId);
  });

  it("gates egress once before any read for a non-deterministic chain", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-chain-egress-"));
    tempRoots.push(root);
    const specPath = join(root, "chain.json");
    await writeFile(specPath, JSON.stringify({ steps: [{ id: "a", task: "t", use: ["ko_a"] }] }), "utf8");

    let dbCreated = false;
    const networkAdapter: RunAdapter = { id: "anthropic", deterministic: false, run: async () => ({ output: {} }) };

    await expect(
      runChainCommand(
        { dbUrl: "postgres://example", chain: specPath, adapter: "anthropic" },
        {
          adapters: new Map([["anthropic", networkAdapter]]),
          createDb: () => {
            dbCreated = true;
            return { execute: async () => [] };
          },
          stdout: { log: () => undefined },
        },
      ),
    ).rejects.toThrow("--ack-egress");
    expect(dbCreated).toBe(false);
  });

  it("aborts the chain on a step failure and names the failed step", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-chain-fail-"));
    tempRoots.push(root);
    const configPath = await writeConfig();
    const specPath = join(root, "chain.json");
    await writeFile(specPath, JSON.stringify({ steps: [{ id: "boom", task: "t", use: ["ko_a"] }] }), "utf8");

    const seeded = new Map<string, SignedKnowledgeObject>([["ko_a", inputKo("ko_a", { kind: "doc" })]]);
    const failingAdapter: RunAdapter = {
      id: "deterministic",
      deterministic: true,
      run: async () => {
        throw new Error("adapter exploded");
      },
    };

    await expect(
      runChainCommand(
        { config: configPath, dbUrl: "postgres://example", chain: specPath, adapter: "deterministic" },
        {
          adapters: new Map([["deterministic", failingAdapter]]),
          createDb: () => ({ execute: async () => [] }),
          readKnowledgeObject: fakeRead(seeded),
          stdout: { log: () => undefined },
          now: () => new Date("2026-05-22T00:00:00.000Z"),
        },
      ),
    ).rejects.toThrow(/Chain step "boom" failed: adapter exploded/);
  });

  it("rejects a chain spec with a forward @ref before any run", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-chain-badref-"));
    tempRoots.push(root);
    const specPath = join(root, "chain.json");
    await writeFile(
      specPath,
      JSON.stringify({ steps: [{ id: "a", task: "t", use: ["@later"] }, { id: "later", task: "t2", use: ["ko_a"] }] }),
      "utf8",
    );

    let dbCreated = false;
    await expect(
      runChainCommand(
        { dbUrl: "postgres://example", chain: specPath, adapter: "deterministic" },
        {
          createDb: () => {
            dbCreated = true;
            return { execute: async () => [] };
          },
          stdout: { log: () => undefined },
        },
      ),
    ).rejects.toThrow(/not a prior step/);
    expect(dbCreated).toBe(false);
  });

  it("requires at least one --use input", async () => {
    await expect(
      agentRunCommand(
        "report",
        { dbUrl: "postgres://example", use: [], adapter: "deterministic" },
        { createDb: () => ({ execute: async () => [] }), stdout: { log: () => undefined } },
      ),
    ).rejects.toThrow("at least one input Knowledge Object");
  });
});

async function writeConfig(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "stacy-federation-run-"));
  tempRoots.push(root);
  const configPath = join(root, "instances", "demo", "config.json");
  await mkdir(join(root, "instances", "demo"), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      $meta: { version: 1, updatedAt: "2026-05-22T00:00:00.000Z", source: "onboard" },
      database: {
        mode: "embedded-postgres",
        embeddedPostgresDataDir: join(root, "db"),
        embeddedPostgresPort: 55470,
        backup: { enabled: true, intervalMinutes: 60, retentionDays: 7, dir: join(root, "backups") },
      },
      logging: { mode: "file", logDir: join(root, "logs") },
      server: {
        deploymentMode: "local_trusted",
        exposure: "private",
        host: "127.0.0.1",
        port: 3100,
        allowedHostnames: [],
        serveUi: true,
      },
      telemetry: { enabled: false },
    }),
    { mode: 0o600 },
  );
  return configPath;
}
