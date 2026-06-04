import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BrainDb } from "../src/brain/brain-store.js";
import { createConsentGrant } from "../src/consent/grant.js";
import { createInstallIdentity } from "../src/identity/install-identity.js";
import { resolveFederationIdentityPath } from "../src/identity/paths.js";
import { createKnowledgeObject, type SignedKnowledgeObject } from "../src/ko/knowledge-object.js";
import { brainDeriveCommand } from "./brain-derive.js";

const tempRoots: string[] = [];

describe("brainDeriveCommand", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  it("creates a derived KO from a write-granted federated KO and prints JSON metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-brain-derive-"));
    tempRoots.push(root);
    const configPath = await writeConfig(root, 55446);
    const instanceRoot = join(root, "instances", "demo");
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    await mkdir(join(instanceRoot, "secrets"), { recursive: true });
    await writeFile(resolveFederationIdentityPath(instanceRoot), JSON.stringify(consumer.record), { mode: 0o600 });
    const sourceKo = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Source" },
      identity: producer,
      idGenerator: () => "ko_source_cli",
    });
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: sourceKo.id,
      koContentHash: sourceKo.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      scope: "write",
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      idGenerator: () => "grant_write_cli",
    });
    const lines: string[] = [];

    await brainDeriveCommand(
      sourceKo.id,
      {
        config: configPath,
        dbUrl: "postgres://example",
        contentJson: JSON.stringify({ analysis: "Follow-up analysis" }),
        koId: "ko_derived_cli",
        json: true,
      },
      {
        createDb: () => dbForRows([
          koRow(sourceKo, {
            source: "federated",
            creatorInstallId: producer.record.installId,
            receivedFromInstallId: producer.record.installId,
            storedAt: "2026-05-22T00:00:00.000Z",
          }),
          [{ id: grant.id, signed_payload_json: grant.signedPayload, signer_json: grant.signer, signature: grant.signature }],
          [],
        ]),
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      id: "ko_derived_cli",
      sourceKoId: "ko_source_cli",
      sourceContentHash: sourceKo.signedPayload.contentHash,
      sourceProducerInstallId: producer.record.installId,
      grantId: "grant_write_cli",
      creatorInstallId: consumer.record.installId,
    });
  });

  it("rejects invalid JSON before opening the database", async () => {
    const openedConnections: string[] = [];

    await expect(
      brainDeriveCommand(
        "ko_source",
        {
          dbUrl: "postgres://example",
          contentJson: "{not json",
        },
        {
          createDb: (connectionString) => {
            openedConnections.push(connectionString);
            return { execute: async () => [] };
          },
          stdout: { log: () => undefined },
        },
      ),
    ).rejects.toThrow();

    expect(openedConnections).toEqual([]);
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
