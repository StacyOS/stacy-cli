import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createInstallIdentity } from "../src/identity/install-identity.js";
import { createKnowledgeObject } from "../src/ko/knowledge-object.js";
import { brainShowCommand } from "./brain-show.js";

const tempRoots: string[] = [];

describe("brainShowCommand", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  it("prints verified KO JSON from the Brain store", async () => {
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Local Brain" },
      identity,
      idGenerator: () => "ko_cli_show",
    });
    const lines: string[] = [];

    await brainShowCommand(
      ko.id,
      { dbUrl: "postgres://example", json: true },
      {
        createDb: () => ({ execute: async () => [] }),
        readKnowledgeObject: async () => ({
          ok: true,
          ko,
          provenance: {
            source: "local",
            creatorInstallId: identity.record.installId,
            storedAt: "2026-05-22T00:00:00.000Z",
          },
          verification: { contentHash: ko.signedPayload.contentHash },
        }),
        stdout: { log: (line) => lines.push(line) },
      },
    );

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      id: "ko_cli_show",
      tenant: "stacy/acme",
      contentHash: ko.signedPayload.contentHash,
      content: { title: "Local Brain" },
      verified: true,
    });
  });

  it("prints a compact provenance view by default", async () => {
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Local Brain" },
      identity,
      idGenerator: () => "ko_text",
    });
    const lines: string[] = [];

    await brainShowCommand(
      ko.id,
      { dbUrl: "postgres://example" },
      {
        createDb: () => ({ execute: async () => [] }),
        readKnowledgeObject: async () => ({
          ok: true,
          ko,
          provenance: {
            source: "local",
            creatorInstallId: identity.record.installId,
            storedAt: "2026-05-22T00:00:00.000Z",
          },
          verification: { contentHash: ko.signedPayload.contentHash },
        }),
        stdout: { log: (line) => lines.push(line) },
      },
    );

    expect(lines.join("\n")).toContain("Knowledge Object: ko_text");
    expect(lines.join("\n")).toContain("Content hash: sha256:");
    expect(lines.join("\n")).toContain('"title": "Local Brain"');
  });

  it("renders dashboard-shaped content as a static dashboard view", async () => {
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/vnd.stacy.dashboard+json",
      content: {
        title: "Phase 2 Dashboard",
        summary: "A compact dashboard summary.",
        input: {
          fileName: "acme-q2-revenue.csv",
          rows: 3,
          contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        widgets: [{ kind: "metric", label: "Signed KOs", value: 1 }],
      },
      identity,
      idGenerator: () => "ko_dashboard",
    });
    const lines: string[] = [];

    await brainShowCommand(
      ko.id,
      { dbUrl: "postgres://example" },
      {
        createDb: () => ({ execute: async () => [] }),
        readKnowledgeObject: async () => ({
          ok: true,
          ko,
          provenance: {
            source: "local",
            creatorInstallId: identity.record.installId,
            storedAt: "2026-05-22T00:00:00.000Z",
          },
          verification: { contentHash: ko.signedPayload.contentHash },
        }),
        stdout: { log: (line) => lines.push(line) },
      },
    );

    expect(lines.join("\n")).toContain("Dashboard: Phase 2 Dashboard");
    expect(lines.join("\n")).toContain("Summary: A compact dashboard summary.");
    expect(lines.join("\n")).toContain("Input: acme-q2-revenue.csv (3 rows, sha256:");
    expect(lines.join("\n")).toContain("Signature: verified");
    expect(lines.join("\n")).toContain("Consent: local owner read");
    expect(lines.join("\n")).toContain("1. [metric] Signed KOs: 1");
  });

  it("resolves embedded Postgres connection strings from Stacy config", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-config-"));
    tempRoots.push(root);
    const configPath = join(root, "config.json");
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
          embeddedPostgresPort: 55444,
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
    );
    const seenConnectionStrings: string[] = [];

    await expect(
      brainShowCommand(
        "missing",
        { config: configPath },
        {
          createDb: (connectionString) => {
            seenConnectionStrings.push(connectionString);
            return { execute: async () => [] };
          },
          readKnowledgeObject: async () => ({ ok: false, reason: "not found" }),
          stdout: { log: () => undefined },
        },
      ),
    ).rejects.toThrow("not found");

    expect(seenConnectionStrings).toEqual([
      "postgres://stacy:stacy@127.0.0.1:55444/stacy",
    ]);
  });

  it("denies federated reads through --as-consumer when no grant exists", async () => {
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Federated" },
      identity,
      idGenerator: () => "ko_federated_no_grant",
    });

    await expect(
      brainShowCommand(
        ko.id,
        { dbUrl: "postgres://example", asConsumer: "install_consumer" },
        {
          createDb: () => {
            const rows = [
              [],
              [],
              [
                {
                  id: ko.id,
                  signed_payload_json: ko.signedPayload,
                  signer_json: ko.signer,
                  signature: ko.signature,
                  provenance_json: {
                    source: "federated",
                    creatorInstallId: identity.record.installId,
                    receivedFromInstallId: identity.record.installId,
                    storedAt: "2026-05-22T00:00:00.000Z",
                  },
                },
              ],
              [],
              [],
              [],
              [],
            ];
            let index = 0;
            return {
              execute: async () => rows[index++] ?? [],
            };
          },
          stdout: { log: () => undefined },
        },
      ),
    ).rejects.toThrow("Missing consent grant");
  });
});
