import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDb,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
  type EmbeddedPostgresTestDatabase,
} from "@arpanstacy/stacy-db";
import { afterEach, describe, expect, it } from "vitest";

import { resolveFederationIdentityPath } from "../identity/paths.js";
import { readKnowledgeObject } from "./brain-store.js";
import { createLocalKnowledgeObject } from "./local-brain.js";
import { brainCreateCommand } from "../../verbs/brain-create.js";
import { brainShowCommand } from "../../verbs/brain-show.js";
import { revokeCommand } from "../../verbs/revoke.js";
import { shareCommand } from "../../verbs/share.js";
import { ensureInstallIdentity } from "../identity/install-identity.js";
import { listReceipts } from "../receipts/receipt-store.js";
import { storeRevocationTombstone } from "../consent/revocation-store.js";
import type { SignedRevocationTombstone } from "../consent/revocation.js";
import {
  receiveFederationMessage,
  type FederationKnowledgeObjectMessage,
} from "../sync/federation-message.js";

const realDbSmokeEnabled = process.env.STACY_FEDERATION_REAL_DB_SMOKE === "1";
const embeddedPostgresSupport = realDbSmokeEnabled
  ? await getEmbeddedPostgresTestSupport()
  : { supported: false, reason: "set STACY_FEDERATION_REAL_DB_SMOKE=1 to run" };
const describeEmbeddedPostgres = realDbSmokeEnabled && embeddedPostgresSupport.supported
  ? describe
  : describe.skip;
const cleanups: Array<() => Promise<void>> = [];
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const cliEntrypoint = resolve(repoRoot, "cli/src/index.ts");
const tsxEntrypoint = resolve(repoRoot, "cli/node_modules/tsx/dist/cli.mjs");

if (realDbSmokeEnabled && !embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping federation local Brain integration tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

describeEmbeddedPostgres("local Brain integration", () => {
  it(
    "creates, stores, and reads a local signed KO with provenance using Stacy Postgres",
    async () => {
      const tempDb = await startTrackedDb();
      const instanceRoot = await mkdtemp(join(tmpdir(), "stacy-federation-instance-"));
      cleanups.push(async () => {
        await rm(instanceRoot, { recursive: true, force: true });
      });

      const db = createDb(tempDb.connectionString);
      cleanups.push(async () => {
        await db.$client.end();
      });

      const created = await createLocalKnowledgeObject({
        db,
        identityPath: resolveFederationIdentityPath(instanceRoot),
        contentType: "application/json",
        content: {
          title: "Single install Phase 2",
          widgets: [{ kind: "metric", label: "KO", value: 1 }],
        },
        createdAt: new Date("2026-05-22T00:00:00.000Z"),
        storedAt: new Date("2026-05-22T00:00:01.000Z"),
        idGenerator: () => "ko_real_db_local",
      });

      const read = await readKnowledgeObject({ db, koId: created.ko.id });

      expect(read).toMatchObject({
        ok: true,
        ko: {
          id: "ko_real_db_local",
          signedPayload: {
            tenant: "stacy/acme",
            creatorInstallId: created.creatorInstallId,
            content: {
              title: "Single install Phase 2",
            },
          },
        },
        provenance: {
          source: "local",
          creatorInstallId: created.creatorInstallId,
        },
        verification: {
          contentHash: created.contentHash,
        },
      });
    },
    30_000,
  );

  it(
    "creates and shows a local KO through the Phase 2 Brain command layer",
    async () => {
      const tempDb = await startTrackedDb();
      const instanceRoot = await mkdtemp(join(tmpdir(), "stacy-federation-cli-instance-"));
      cleanups.push(async () => {
        await rm(instanceRoot, { recursive: true, force: true });
      });
      const configPath = join(instanceRoot, "config.json");
      await writeFile(
        configPath,
        JSON.stringify(createTestConfig(instanceRoot, tempDb.connectionString), null, 2),
        { mode: 0o600 },
      );

      const db = createDb(tempDb.connectionString);
      cleanups.push(async () => {
        await db.$client.end();
      });

      const createOutput: string[] = [];
      await brainCreateCommand(
        {
          config: configPath,
          contentJson: JSON.stringify({ title: "CLI local loop" }),
          koId: "ko_cli_real_db",
          json: true,
        },
        {
          createDb: () => db,
          stdout: { log: (line) => createOutput.push(line) },
          now: () => new Date("2026-05-22T00:00:00.000Z"),
        },
      );

      const showOutput: string[] = [];
      await brainShowCommand(
        "ko_cli_real_db",
        { config: configPath, json: true },
        {
          createDb: () => db,
          stdout: { log: (line) => showOutput.push(line) },
        },
      );

      expect(JSON.parse(createOutput[0] ?? "{}")).toMatchObject({
        id: "ko_cli_real_db",
        contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });
      expect(JSON.parse(showOutput[0] ?? "{}")).toMatchObject({
        id: "ko_cli_real_db",
        tenant: "stacy/acme",
        content: { title: "CLI local loop" },
        provenance: {
          source: "local",
        },
        verified: true,
      });
    },
    30_000,
  );

  it(
    "creates and shows a local KO through the actual Stacy CLI process",
    async () => {
      const tempDb = await startTrackedDb();
      const instanceRoot = await mkdtemp(join(tmpdir(), "stacy-federation-cli-process-"));
      cleanups.push(async () => {
        await rm(instanceRoot, { recursive: true, force: true });
      });
      const configPath = join(instanceRoot, "config.json");
      await writeFile(
        configPath,
        JSON.stringify(createTestConfig(instanceRoot, tempDb.connectionString), null, 2),
        { mode: 0o600 },
      );

      const createResult = await runStacyCli([
        "brain",
        "create",
        "--config",
        configPath,
        "--db-url",
        tempDb.connectionString,
        "--prompt",
        "Actual CLI local loop",
        "--ko-id",
        "ko_actual_cli_real_db",
        "--json",
      ], { instanceRoot });

      expect(formatCliResult(createResult)).toMatchObject({ exitCode: 0 });
      expect(JSON.parse(createResult.stdout)).toMatchObject({
        id: "ko_actual_cli_real_db",
        tenant: "stacy/acme",
        contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });

      const showResult = await runStacyCli([
        "brain",
        "show",
        "ko_actual_cli_real_db",
        "--config",
        configPath,
        "--db-url",
        tempDb.connectionString,
        "--json",
      ], { instanceRoot });

      if (showResult.exitCode !== 0) {
        console.error("stacy brain show failed", formatCliResult(showResult));
      }
      expect(formatCliResult(showResult)).toMatchObject({ exitCode: 0 });
      expect(JSON.parse(showResult.stdout)).toMatchObject({
        id: "ko_actual_cli_real_db",
        tenant: "stacy/acme",
        content: {
          kind: "agent_output",
          prompt: "Actual CLI local loop",
          output: "Deterministic Stacy federation KO content for prompt: Actual CLI local loop",
          generator: "deterministic_fallback",
        },
        provenance: {
          source: "local",
        },
        verified: true,
      });
    },
    30_000,
  );

  it(
    "shares a local KO, receives it into another install, and enforces read consent",
    async () => {
      const dbA = await startTrackedDb();
      const dbB = await startTrackedDb();
      const instanceRootA = await mkdtemp(join(tmpdir(), "stacy-federation-share-a-"));
      const instanceRootB = await mkdtemp(join(tmpdir(), "stacy-federation-share-b-"));
      cleanups.push(async () => {
        await rm(instanceRootA, { recursive: true, force: true });
        await rm(instanceRootB, { recursive: true, force: true });
      });
      const configPathA = join(instanceRootA, "config.json");
      const configPathB = join(instanceRootB, "config.json");
      await Promise.all([
        writeFile(
          configPathA,
          JSON.stringify(createTestConfig(instanceRootA, dbA.connectionString), null, 2),
          { mode: 0o600 },
        ),
        writeFile(
          configPathB,
          JSON.stringify(createTestConfig(instanceRootB, dbB.connectionString), null, 2),
          { mode: 0o600 },
        ),
      ]);

      const dbClientA = createDb(dbA.connectionString);
      const dbClientB = createDb(dbB.connectionString);
      cleanups.push(async () => {
        await dbClientA.$client.end();
        await dbClientB.$client.end();
      });
      const consumerIdentity = await ensureInstallIdentity({
        path: resolveFederationIdentityPath(instanceRootB),
        now: new Date("2026-05-22T00:00:00.000Z"),
      });

      await brainCreateCommand(
        {
          config: configPathA,
          contentJson: JSON.stringify({ title: "Federate me" }),
          koId: "ko_real_share",
          json: true,
        },
        {
          createDb: () => dbClientA,
          stdout: { log: () => undefined },
          now: () => new Date("2026-05-22T00:00:00.000Z"),
        },
      );

      const shareOutput: string[] = [];
      await shareCommand(
        "ko_real_share",
        {
          config: configPathA,
          with: consumerIdentity.record.installId,
          expires: "30d",
          revocable: true,
          json: true,
        },
        {
          createDb: () => dbClientA,
          stdout: { log: (line) => shareOutput.push(line) },
          now: () => new Date("2026-05-22T00:00:00.000Z"),
        },
      );
      const sharePayload = JSON.parse(shareOutput[0] ?? "{}") as {
        message: FederationKnowledgeObjectMessage;
      };

      await receiveFederationMessage({
        db: dbClientB,
        message: sharePayload.message,
        receivedAt: new Date("2026-05-22T00:00:01.000Z"),
      });

      await expect(listReceipts({ db: dbClientA, koId: "ko_real_share" })).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: "create",
            actorInstallId: sharePayload.message.producerInstallId,
          }),
          expect.objectContaining({
            eventType: "sign",
            actorInstallId: sharePayload.message.producerInstallId,
          }),
          expect.objectContaining({
            eventType: "share",
            actorInstallId: sharePayload.message.producerInstallId,
            counterpartyInstallId: consumerIdentity.record.installId,
          }),
        ]),
      );
      await expect(listReceipts({ db: dbClientB, koId: "ko_real_share" })).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: "receive",
            actorInstallId: consumerIdentity.record.installId,
            counterpartyInstallId: sharePayload.message.producerInstallId,
          }),
          expect.objectContaining({
            eventType: "store",
            actorInstallId: consumerIdentity.record.installId,
            counterpartyInstallId: sharePayload.message.producerInstallId,
          }),
        ]),
      );

      const showOutput: string[] = [];
      await brainShowCommand(
        "ko_real_share",
        {
          config: configPathB,
          asConsumer: consumerIdentity.record.installId,
          json: true,
        },
        {
          createDb: () => dbClientB,
          stdout: { log: (line) => showOutput.push(line) },
        },
      );

      expect(JSON.parse(showOutput[0] ?? "{}")).toMatchObject({
        id: "ko_real_share",
        content: { title: "Federate me" },
        provenance: {
          source: "federated",
        },
        verified: true,
      });

      await expect(listReceipts({ db: dbClientB, koId: "ko_real_share" })).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: "read",
            actorInstallId: consumerIdentity.record.installId,
          }),
        ]),
      );

      const revokeOutput: string[] = [];
      await revokeCommand(
        "ko_real_share",
        {
          config: configPathA,
          reason: "Access no longer permitted",
          json: true,
        },
        {
          createDb: () => dbClientA,
          stdout: { log: (line) => revokeOutput.push(line) },
          now: () => new Date("2026-05-22T00:00:02.000Z"),
        },
      );
      const revokePayload = JSON.parse(revokeOutput[0] ?? "{}") as {
        tombstone: SignedRevocationTombstone;
      };
      await storeRevocationTombstone({
        db: dbClientB,
        tombstone: revokePayload.tombstone,
        storedAt: new Date("2026-05-22T00:00:03.000Z"),
      });

      await expect(
        brainShowCommand(
          "ko_real_share",
          {
            config: configPathB,
            asConsumer: consumerIdentity.record.installId,
            json: true,
          },
          {
            createDb: () => dbClientB,
            stdout: { log: () => undefined },
          },
        ),
      ).rejects.toThrow("Consent grant has been revoked");

      const reopenedA = createDb(dbA.connectionString);
      const reopenedB = createDb(dbB.connectionString);
      cleanups.push(async () => {
        await reopenedA.$client.end();
        await reopenedB.$client.end();
      });

      await expect(listReceipts({ db: reopenedA, koId: "ko_real_share" })).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventType: "create" }),
          expect.objectContaining({ eventType: "sign" }),
          expect.objectContaining({ eventType: "share" }),
          expect.objectContaining({ eventType: "revoke" }),
        ]),
      );
      await expect(listReceipts({ db: reopenedB, koId: "ko_real_share" })).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventType: "receive" }),
          expect.objectContaining({ eventType: "store" }),
          expect.objectContaining({ eventType: "read" }),
          expect.objectContaining({ eventType: "deny" }),
        ]),
      );
    },
    30_000,
  );
});

async function startTrackedDb(): Promise<EmbeddedPostgresTestDatabase> {
  const tempDb = await startEmbeddedPostgresTestDatabase("stacy-federation-local-brain-");
  cleanups.push(tempDb.cleanup);
  return tempDb;
}

function formatCliResult(result: {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}) {
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function createTestConfig(instanceRoot: string, connectionString: string): Record<string, unknown> {
  return {
    $meta: {
      version: 1,
      updatedAt: "2026-05-22T00:00:00.000Z",
      source: "onboard",
    },
    database: {
      mode: "postgres",
      connectionString,
      embeddedPostgresDataDir: join(instanceRoot, "db"),
      embeddedPostgresPort: 54329,
      backup: {
        enabled: true,
        intervalMinutes: 60,
        retentionDays: 7,
        dir: join(instanceRoot, "backups"),
      },
    },
    logging: { mode: "file", logDir: join(instanceRoot, "logs") },
    server: {
      deploymentMode: "local_trusted",
      exposure: "private",
      host: "127.0.0.1",
      port: 3100,
      allowedHostnames: [],
      serveUi: true,
    },
    telemetry: { enabled: false },
  };
}

async function runStacyCli(
  args: readonly string[],
  options: { readonly instanceRoot: string },
): Promise<{ readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }> {
  const homeDir = dirname(dirname(options.instanceRoot));
  const child = spawn(process.execPath, [tsxEntrypoint, cliEntrypoint, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      STACY_HOME: homeDir,
      STACY_INSTANCE_ID: "federation-demo",
      STACY_TELEMETRY_DISABLED: "1",
      STACY_MIGRATION_AUTO_APPLY: "true",
      STACY_MIGRATION_PROMPT: "never",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.on("error", reject);
    child.on("close", resolveExit);
  });

  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}
