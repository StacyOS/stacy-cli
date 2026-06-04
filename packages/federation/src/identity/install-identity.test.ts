import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createInstallIdentity,
  ensureInstallIdentity,
  parseInstallIdentity,
} from "./install-identity.js";

const tempRoots: string[] = [];

describe("install identity", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  it("creates a stable identity id from the public key", () => {
    const identity = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const parsed = parseInstallIdentity(JSON.stringify(identity.record));

    expect(parsed.record.installId).toBe(identity.record.installId);
    expect(parsed.record.personId).toMatch(/^person_/);
    expect(parsed.record.workerId).toMatch(/^worker_/);
    expect(parsed.record.createdAt).toBe("2026-05-22T00:00:00.000Z");
  });

  it("persists and reloads the same keypair", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-identity-"));
    tempRoots.push(root);
    const path = join(root, "identity.json");

    const created = await ensureInstallIdentity({
      path,
      now: new Date("2026-05-22T01:02:03.000Z"),
    });
    const loaded = await ensureInstallIdentity({ path });
    const mode = (await stat(path)).mode & 0o777;

    expect(loaded.record).toEqual(created.record);
    expect(await readFile(path, "utf8")).toContain('"privateKeyPem"');
    expect(mode).toBe(0o600);
  });

  it("rejects an identity whose id no longer matches its public key", () => {
    const identity = createInstallIdentity();

    expect(() =>
      parseInstallIdentity(
        JSON.stringify({ ...identity.record, installId: "install_wrong" }),
      ),
    ).toThrow("does not match");
  });

  it("rejects an identity whose private key does not match its public key", () => {
    const identity = createInstallIdentity();
    const otherIdentity = createInstallIdentity();

    expect(() =>
      parseInstallIdentity(
        JSON.stringify({
          ...identity.record,
          privateKeyPem: otherIdentity.record.privateKeyPem,
        }),
      ),
    ).toThrow("private key does not match");
  });
});
