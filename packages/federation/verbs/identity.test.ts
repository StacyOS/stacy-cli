import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createInstallIdentity, parseInstallIdentity } from "../src/identity/install-identity.js";
import { resolveFederationIdentityPath } from "../src/identity/paths.js";
import type { SignedKeyTransition } from "../src/identity/key-transition.js";
import { verifyKeyTransition } from "../src/identity/key-transition.js";
import {
  identityBackupCommand,
  identityRotateCommand,
  identityShowCommand,
  identityVerifyChainCommand,
} from "./identity.js";

describe("identity verbs", () => {
  it("rotates the active install identity after storing a signed transition", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-identity-rotate-"));
    const configPath = join(root, "instances", "demo", "config.json");
    const identityPath = resolveFederationIdentityPath(dirname(configPath));
    const oldIdentity = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const newIdentity = createInstallIdentity(new Date("2026-05-23T00:00:00.000Z"));
    const transitions: SignedKeyTransition[] = [];
    const logs: string[] = [];

    await mkdir(dirname(identityPath), { recursive: true });
    await writeFile(identityPath, `${JSON.stringify(oldIdentity.record, null, 2)}\n`);

    await identityRotateCommand(
      {
        config: configPath,
        dbUrl: "postgres://example",
        reason: "operator requested",
        json: true,
      },
      {
        now: new Date("2026-05-23T01:00:00.000Z"),
        createDb: () => ({ execute: async () => [] }),
        createIdentity: () => newIdentity,
        storeTransition: async ({ transition }) => {
          transitions.push(transition);
        },
        stdout: { log: (line) => logs.push(line) },
      },
    );

    const active = parseInstallIdentity(await readFile(identityPath, "utf8"));
    const backup = parseInstallIdentity(
      await readFile(
        join(dirname(identityPath), `federation-install-identity.${oldIdentity.record.installId}.previous.json`),
        "utf8",
      ),
    );

    expect(active.record.installId).toBe(newIdentity.record.installId);
    expect(backup.record.installId).toBe(oldIdentity.record.installId);
    expect(transitions).toHaveLength(1);
    expect(verifyKeyTransition(transitions[0])).toMatchObject({ ok: true });
    expect(JSON.parse(logs[0]) as unknown).toMatchObject({
      oldInstallId: oldIdentity.record.installId,
      newInstallId: newIdentity.record.installId,
    });
  });

  it("prints key-chain verification status", async () => {
    const logs: string[] = [];
    await identityVerifyChainCommand(
      { config: "/tmp/stacy/config.json", dbUrl: "postgres://example" },
      {
        createDb: () => ({ execute: async () => [] }),
        listTransitions: async () => [],
        stdout: { log: (line) => logs.push(line) },
      },
    );

    expect(logs).toEqual(["Install key chain valid. No rotations recorded."]);
  });

  it("shows the install identity and public key without the private key", async () => {
    const identity = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const logs: string[] = [];

    await identityShowCommand(
      { config: "/tmp/stacy/config.json", dbUrl: "postgres://example", json: true },
      {
        loadIdentity: async () => identity,
        stdout: { log: (line) => logs.push(line) },
      },
    );

    const summary = JSON.parse(logs[0] ?? "{}") as Record<string, unknown>;
    expect(summary).toMatchObject({
      installId: identity.record.installId,
      personId: identity.record.personId,
      workerId: identity.record.workerId,
      publicKeyPem: identity.record.publicKeyPem,
    });
    expect(logs.join("\n")).not.toContain("PRIVATE KEY");
  });

  it("writes a private identity backup to disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-identity-backup-"));
    const identity = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const backupPath = join(root, "backup.json");
    const logs: string[] = [];

    await identityBackupCommand(
      { config: "/tmp/stacy/config.json", dbUrl: "postgres://example", out: backupPath, json: true },
      {
        loadIdentity: async () => identity,
        stdout: { log: (line) => logs.push(line) },
      },
    );

    const restored = parseInstallIdentity(await readFile(backupPath, "utf8"));
    expect(restored.record.installId).toBe(identity.record.installId);
    expect(restored.record.privateKeyPem).toBe(identity.record.privateKeyPem);
    expect(JSON.parse(logs[0] ?? "{}") as unknown).toMatchObject({
      installId: identity.record.installId,
      backupPath,
    });
  });
});
