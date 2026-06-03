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
import { agentRunCommand, runOnce } from "./run.js";
import { resolveLocalRuntime } from "./local-runtime.js";

const tempRoots: string[] = [];
const identity = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));

function inputKo(id: string, content: CanonicalJsonValue): SignedKnowledgeObject {
  return createKnowledgeObject({
    tenant: "stacy/acme",
    contentType: "application/json",
    content,
    identity,
    createdAt: new Date("2026-05-21T00:00:00.000Z"),
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
