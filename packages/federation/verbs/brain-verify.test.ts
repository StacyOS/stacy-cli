import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BrainDb } from "../src/brain/brain-store.js";
import { parseCsvDashboardInput } from "../src/dashboard/dashboard-content.js";
import { createInstallIdentity } from "../src/identity/install-identity.js";
import { resolveFederationIdentityPath } from "../src/identity/paths.js";
import { createKnowledgeObject, type SignedKnowledgeObject } from "../src/ko/knowledge-object.js";
import { brainVerifyCommand } from "./brain-verify.js";

const tempRoots: string[] = [];

describe("brainVerifyCommand", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  it("creates a verification KO from a source KO and prints JSON metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-brain-verify-"));
    tempRoots.push(root);
    const configPath = await writeConfig(root, 55447);
    const instanceRoot = join(root, "instances", "demo");
    const producer = createInstallIdentity();
    const verifier = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    await mkdir(join(instanceRoot, "secrets"), { recursive: true });
    await writeFile(resolveFederationIdentityPath(instanceRoot), JSON.stringify(verifier.record), { mode: 0o600 });
    const csvPath = join(root, "acme.csv");
    const csv = "revenue,pipeline\n100,500\n200,700\n";
    await writeFile(csvPath, csv);
    const input = parseCsvDashboardInput(csvPath, csv);
    const sourceKo = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: {
        kind: "dashboard",
        title: "Revenue dashboard",
        task: "build dashboard",
        input: {
          fileName: input.fileName,
          contentHash: input.contentHash,
          rows: input.rows,
        },
        widgets: [{ kind: "metric", label: "Revenue", value: "$300" }],
        summary: "Revenue increased.",
        generator: "adapter_command",
        generatedAt: "2026-05-22T00:00:00.000Z",
      },
      identity: producer,
      idGenerator: () => "ko_source_verify_cli",
    });
    const lines: string[] = [];

    await brainVerifyCommand(
      sourceKo.id,
      {
        config: configPath,
        dbUrl: "postgres://example",
        input: csvPath,
        koId: "ko_verification_cli",
        json: true,
      },
      {
        createDb: () => dbForRows([
          koRow(sourceKo, {
            source: "local",
            creatorInstallId: producer.record.installId,
            storedAt: "2026-05-22T00:00:00.000Z",
          }),
        ]),
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      id: "ko_verification_cli",
      sourceKoId: "ko_source_verify_cli",
      sourceContentHash: sourceKo.signedPayload.contentHash,
      sourceProducerInstallId: producer.record.installId,
      verdict: "pass",
      creatorInstallId: verifier.record.installId,
    });
  });
});

function dbForRows(rows: readonly unknown[]): BrainDb {
  let index = 0;
  return {
    execute: async () => rows[index++] ?? [],
  };
}

function koRow(ko: SignedKnowledgeObject, provenance: Record<string, unknown>) {
  return [
    {
      id: ko.id,
      signed_payload_json: ko.signedPayload,
      signer_json: ko.signer,
      signature: ko.signature,
      provenance_json: provenance,
    },
  ];
}

async function writeConfig(root: string, port: number): Promise<string> {
  const configPath = join(root, "instances", "demo", "config.json");
  await mkdir(join(root, "instances", "demo"), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      $meta: {
        version: 1,
        updatedAt: "2026-05-22T00:00:00.000Z",
        source: "onboard",
      },
      database: {
        mode: "embedded-postgres",
        embeddedPostgresDataDir: join(root, "db"),
        embeddedPostgresPort: port,
        backup: {
          enabled: true,
          intervalMinutes: 60,
          retentionDays: 7,
          dir: join(root, "backups"),
        },
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
