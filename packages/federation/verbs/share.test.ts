import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BrainDb } from "../src/brain/brain-store.js";
import { createInstallIdentity } from "../src/identity/install-identity.js";
import { resolveFederationIdentityPath } from "../src/identity/paths.js";
import { createKnowledgeObject } from "../src/ko/knowledge-object.js";
import { shareCommand } from "./share.js";
import { addContact, resolveContactsPath } from "../src/contacts/contact-store.js";

const tempRoots: string[] = [];

describe("shareCommand", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  it("creates a signed grant and prints a federation message", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-share-"));
    tempRoots.push(root);
    const instanceRoot = join(root, "instances", "demo");
    const configPath = join(instanceRoot, "config.json");
    const producer = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Share" },
      identity: producer,
      idGenerator: () => "ko_share_cli",
    });
    await mkdir(join(instanceRoot, "secrets"), { recursive: true });
    await writeFile(resolveFederationIdentityPath(instanceRoot), JSON.stringify(producer.record), {
      mode: 0o600,
    });
    await writeFile(configPath, JSON.stringify(testConfig(root)), { mode: 0o600 });
    const lines: string[] = [];

    await shareCommand(
      ko.id,
      {
        config: configPath,
        dbUrl: "postgres://example",
        with: consumer.record.installId,
        expires: "30d",
        revocable: true,
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
                creatorInstallId: producer.record.installId,
                storedAt: "2026-05-22T00:00:00.000Z",
              },
            },
          ],
          [],
          [],
        ]),
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      koId: "ko_share_cli",
      producerInstallId: producer.record.installId,
      consumerInstallId: consumer.record.installId,
      expiresAt: "2026-06-21T00:00:00.000Z",
      message: {
        kind: "federation_ko_message",
        sender: {
          installId: producer.record.installId,
        },
        grant: {
          signedPayload: {
            koId: "ko_share_cli",
            consumerInstallId: consumer.record.installId,
            revocable: true,
          },
        },
      },
    });
  });

  it("posts the signed federation message when an endpoint is provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-share-deliver-"));
    tempRoots.push(root);
    const instanceRoot = join(root, "instances", "demo");
    const configPath = join(instanceRoot, "config.json");
    const producer = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Deliver" },
      identity: producer,
      idGenerator: () => "ko_share_deliver",
    });
    await mkdir(join(instanceRoot, "secrets"), { recursive: true });
    await writeFile(resolveFederationIdentityPath(instanceRoot), JSON.stringify(producer.record), {
      mode: 0o600,
    });
    await writeFile(configPath, JSON.stringify(testConfig(root)), { mode: 0o600 });
    const deliveries: Array<{ readonly url: string; readonly body: unknown }> = [];
    const lines: string[] = [];

    await shareCommand(
      ko.id,
      {
        config: configPath,
        dbUrl: "postgres://example",
        with: consumer.record.installId,
        to: "http://127.0.0.1:3101/api/federation",
        expires: "30d",
        revocable: true,
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
                creatorInstallId: producer.record.installId,
                storedAt: "2026-05-22T00:00:00.000Z",
              },
            },
          ],
          [],
          [],
        ]),
        fetch: async (url, init) => {
          deliveries.push({ url, body: JSON.parse(init.body) });
          return {
            ok: true,
            status: 201,
            text: async () => JSON.stringify({ accepted: true }),
          };
        },
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      url: "http://127.0.0.1:3101/api/federation",
      body: {
        message: {
          kind: "federation_ko_message",
          producerInstallId: producer.record.installId,
          consumerInstallId: consumer.record.installId,
          ko: { id: "ko_share_deliver" },
        },
      },
    });
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      delivery: {
        endpointUrl: "http://127.0.0.1:3101/api/federation",
        status: 201,
      },
    });
  });

  it("rejects non-loopback http federation endpoints before delivery", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-share-insecure-"));
    tempRoots.push(root);
    const instanceRoot = join(root, "instances", "demo");
    const configPath = join(instanceRoot, "config.json");
    const producer = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Insecure delivery" },
      identity: producer,
      idGenerator: () => "ko_share_insecure_delivery",
    });
    await mkdir(join(instanceRoot, "secrets"), { recursive: true });
    await writeFile(resolveFederationIdentityPath(instanceRoot), JSON.stringify(producer.record), {
      mode: 0o600,
    });
    await writeFile(configPath, JSON.stringify(testConfig(root)), { mode: 0o600 });
    let fetchCalled = false;

    await expect(
      shareCommand(
        ko.id,
        {
          config: configPath,
          dbUrl: "postgres://example",
          with: consumer.record.installId,
          to: "http://stacy.example/api/federation",
          expires: "30d",
          revocable: true,
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
                  creatorInstallId: producer.record.installId,
                  storedAt: "2026-05-22T00:00:00.000Z",
                },
              },
            ],
            [],
            [],
          ]),
          fetch: async () => {
            fetchCalled = true;
            throw new Error("fetch should not be called");
          },
          stdout: { log: () => undefined },
          now: () => new Date("2026-05-22T00:00:00.000Z"),
        },
      ),
    ).rejects.toThrow("must use https://");
    expect(fetchCalled).toBe(false);
  });

  it("rejects non-loopback http revocation lookup URLs", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-share-insecure-revocation-"));
    tempRoots.push(root);
    const instanceRoot = join(root, "instances", "demo");
    const configPath = join(instanceRoot, "config.json");
    const producer = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Insecure revocation" },
      identity: producer,
      idGenerator: () => "ko_share_insecure_revocation",
    });
    await mkdir(join(instanceRoot, "secrets"), { recursive: true });
    await writeFile(resolveFederationIdentityPath(instanceRoot), JSON.stringify(producer.record), {
      mode: 0o600,
    });
    await writeFile(configPath, JSON.stringify(testConfig(root)), { mode: 0o600 });

    await expect(
      shareCommand(
        ko.id,
        {
          config: configPath,
          dbUrl: "postgres://example",
          with: consumer.record.installId,
          to: "https://stacy.example/api/federation",
          revocationUrl: "http://stacy.example/api/federation/revocations",
          expires: "30d",
          revocable: true,
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
                  creatorInstallId: producer.record.installId,
                  storedAt: "2026-05-22T00:00:00.000Z",
                },
              },
            ],
          ]),
          stdout: { log: () => undefined },
          now: () => new Date("2026-05-22T00:00:00.000Z"),
        },
      ),
    ).rejects.toThrow("must use https://");
  });

  it("resolves consumer install and endpoints from --with-contact", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-share-contact-"));
    tempRoots.push(root);
    const instanceRoot = join(root, "instances", "demo");
    const configPath = join(instanceRoot, "config.json");
    const producer = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Contact share" },
      identity: producer,
      idGenerator: () => "ko_share_contact",
    });
    await mkdir(join(instanceRoot, "secrets"), { recursive: true });
    await writeFile(resolveFederationIdentityPath(instanceRoot), JSON.stringify(producer.record), {
      mode: 0o600,
    });
    await writeFile(configPath, JSON.stringify(testConfig(root)), { mode: 0o600 });
    await addContact(resolveContactsPath(instanceRoot), {
      name: "meera",
      label: "Meera",
      installId: consumer.record.installId,
      federationEndpointUrl: "http://127.0.0.1:3102/api/federation",
      revocationUrl: "http://127.0.0.1:3102/api/federation/revocations",
    });
    const deliveries: Array<{ readonly url: string; readonly body: unknown }> = [];
    const lines: string[] = [];

    await shareCommand(
      ko.id,
      {
        config: configPath,
        dbUrl: "postgres://example",
        withContact: "meera",
        revocationUrl: "http://127.0.0.1:3101/api/federation/revocations",
        expires: "30d",
        revocable: true,
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
                creatorInstallId: producer.record.installId,
                storedAt: "2026-05-22T00:00:00.000Z",
              },
            },
          ],
          [],
          [],
        ]),
        fetch: async (url, init) => {
          deliveries.push({ url, body: JSON.parse(init.body) });
          return {
            ok: true,
            status: 201,
            text: async () => JSON.stringify({ accepted: true }),
          };
        },
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    expect(deliveries[0]).toMatchObject({
      url: "http://127.0.0.1:3102/api/federation",
    });
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      consumerInstallId: consumer.record.installId,
      delivery: {
        endpointUrl: "http://127.0.0.1:3102/api/federation",
      },
      message: {
        revocationLookupUrl: "http://127.0.0.1:3101/api/federation/revocations",
      },
    });
  });

  it("rejects unsupported scopes", async () => {
    await expect(
      shareCommand("ko", {
        dbUrl: "postgres://example",
        with: "install_consumer",
        scope: "owner",
      }),
    ).rejects.toThrow("Unsupported consent scope");
  });

  it("creates a write-scope grant for Phase S derived KOs", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-share-write-"));
    tempRoots.push(root);
    const instanceRoot = join(root, "instances", "demo");
    const configPath = join(instanceRoot, "config.json");
    const producer = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Write share" },
      identity: producer,
      idGenerator: () => "ko_share_write",
    });
    await mkdir(join(instanceRoot, "secrets"), { recursive: true });
    await writeFile(resolveFederationIdentityPath(instanceRoot), JSON.stringify(producer.record), {
      mode: 0o600,
    });
    await writeFile(configPath, JSON.stringify(testConfig(root)), { mode: 0o600 });
    const lines: string[] = [];

    await shareCommand(
      ko.id,
      {
        config: configPath,
        dbUrl: "postgres://example",
        with: consumer.record.installId,
        scope: "write",
        expires: "30d",
        revocable: true,
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
                creatorInstallId: producer.record.installId,
                storedAt: "2026-05-22T00:00:00.000Z",
              },
            },
          ],
          [],
          [],
        ]),
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      message: {
        grant: {
          signedPayload: {
            scope: "write",
          },
        },
      },
    });
  });

  it("keeps admin share behavior reserved", async () => {
    await expect(
      shareCommand("ko", {
        dbUrl: "postgres://example",
        with: "install_consumer",
        scope: "admin",
      }),
    ).rejects.toThrow("admin");
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
