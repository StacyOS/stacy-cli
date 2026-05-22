import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readContact, resolveContactsPath } from "../src/contacts/contact-store.js";
import {
  contactsExportCommand,
  contactsImportCommand,
} from "./contacts.js";

const tempRoots: string[] = [];

describe("contacts commands", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("exports a signed contact card and imports it into another install", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-contact-card-"));
    tempRoots.push(root);
    const installA = join(root, "install-a");
    const installB = join(root, "install-b");
    await mkdir(installA, { recursive: true });
    await mkdir(installB, { recursive: true });
    const configA = await writeConfig(installA, 55441);
    const configB = await writeConfig(installB, 55442);
    const cardPath = join(root, "meera.contact-card.json");
    const lines: string[] = [];

    await contactsExportCommand(
      "meera",
      {
        config: configB,
        endpoint: "http://127.0.0.1:3102/api/federation",
        revocationUrl: "http://127.0.0.1:3102/api/federation/revocations",
        label: "Meera's Stacy install",
        out: cardPath,
      },
      {
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    expect(lines.join("\n")).toContain("Wrote signed contact card");
    expect(JSON.parse(await readFile(cardPath, "utf8"))).toMatchObject({
      signedPayload: {
        name: "meera",
        label: "Meera's Stacy install",
        federationEndpointUrl: "http://127.0.0.1:3102/api/federation",
      },
    });

    await contactsImportCommand(
      cardPath,
      { config: configA, as: "meera", json: true },
      { stdout: { log: (line) => lines.push(line) } },
    );

    await expect(readContact(resolveContactsPath(installA), "meera")).resolves.toMatchObject({
      name: "meera",
      label: "Meera's Stacy install",
      federationEndpointUrl: "http://127.0.0.1:3102/api/federation",
    });
  });

  it("rejects tampered contact cards before import", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-contact-card-"));
    tempRoots.push(root);
    const installA = join(root, "install-a");
    const installB = join(root, "install-b");
    await mkdir(installA, { recursive: true });
    await mkdir(installB, { recursive: true });
    const configA = await writeConfig(installA, 55443);
    const configB = await writeConfig(installB, 55444);
    const cardPath = join(root, "meera.contact-card.json");

    await contactsExportCommand(
      "meera",
      {
        config: configB,
        endpoint: "http://127.0.0.1:3102/api/federation",
        revocationUrl: "http://127.0.0.1:3102/api/federation/revocations",
        out: cardPath,
        json: true,
      },
      {
        stdout: { log: () => undefined },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );
    const card = JSON.parse(await readFile(cardPath, "utf8"));
    card.signedPayload.federationEndpointUrl = "http://127.0.0.1:9999/api/federation";
    await writeFile(cardPath, `${JSON.stringify(card, null, 2)}\n`, "utf8");

    await expect(
      contactsImportCommand(
        cardPath,
        { config: configA },
        { stdout: { log: () => undefined } },
      ),
    ).rejects.toThrow("Contact card signature verification failed");
  });
});

async function writeConfig(instanceRoot: string, port: number): Promise<string> {
  const configPath = join(instanceRoot, "config.json");
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
        embeddedPostgresDataDir: join(instanceRoot, "db"),
        embeddedPostgresPort: port,
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
    }),
    "utf8",
  );
  return configPath;
}
