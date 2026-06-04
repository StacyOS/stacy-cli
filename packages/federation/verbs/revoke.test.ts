import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BrainDb } from "../src/brain/brain-store.js";
import { createInstallIdentity } from "../src/identity/install-identity.js";
import { resolveFederationIdentityPath } from "../src/identity/paths.js";
import { createKnowledgeObject } from "../src/ko/knowledge-object.js";
import { revokeCommand } from "./revoke.js";

const tempRoots: string[] = [];

describe("revokeCommand", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("creates a signed tombstone and stores a revoke receipt", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-revoke-"));
    tempRoots.push(root);
    const instanceRoot = join(root, "instances", "demo");
    const configPath = join(instanceRoot, "config.json");
    const issuer = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Revoke me" },
      identity: issuer,
      idGenerator: () => "ko_revoke_cli",
    });
    await mkdir(join(instanceRoot, "secrets"), { recursive: true });
    await writeFile(resolveFederationIdentityPath(instanceRoot), JSON.stringify(issuer.record), {
      mode: 0o600,
    });
    await writeFile(configPath, JSON.stringify(testConfig(root)), { mode: 0o600 });
    const lines: string[] = [];

    await revokeCommand(
      ko.id,
      {
        config: configPath,
        dbUrl: "postgres://example",
        reason: "Access no longer permitted",
        grantId: "grant_revoke_cli",
        json: true,
      },
      {
        createDb: () => dbForRows([
          [
            {
              id: ko.id,
              signed_payload_json: ko.signedPayload,
              signer_json: ko.signer,
              signature: ko.signature,
              provenance_json: {
                source: "local",
                creatorInstallId: issuer.record.installId,
                storedAt: "2026-05-22T00:00:00.000Z",
              },
            },
          ],
          [],
          [],
          [],
          [],
        ]),
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      koId: "ko_revoke_cli",
      issuerInstallId: issuer.record.installId,
      revokedGrantId: "grant_revoke_cli",
      reason: "Access no longer permitted",
      tombstone: {
        signedPayload: {
          kind: "revocation_tombstone",
          koId: "ko_revoke_cli",
          revokedGrantId: "grant_revoke_cli",
        },
      },
    });
  });

  it("rejects empty reasons", async () => {
    await expect(
      revokeCommand("ko", {
        dbUrl: "postgres://example",
        reason: " ",
      }),
    ).rejects.toThrow("reason is required");
  });
});

function dbForRows(rows: readonly unknown[]): BrainDb {
  let index = 0;
  return {
    execute: async () => rows[index++] ?? [],
  };
}

function testConfig(root: string): Record<string, unknown> {
  return {
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
  };
}
