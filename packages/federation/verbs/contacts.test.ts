import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { listContacts, readContact, resolveContactsPath } from "../src/contacts/contact-store.js";
import {
  contactsExportCommand,
  contactsImportCommand,
  contactsImportLinkCommand,
  contactsShareLinkCommand,
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

  it("creates a short-lived signed share link and imports it into another install", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-contact-link-"));
    tempRoots.push(root);
    const installA = join(root, "install-a");
    const installB = join(root, "install-b");
    await mkdir(installA, { recursive: true });
    await mkdir(installB, { recursive: true });
    const configA = await writeConfig(installA, 55445);
    const configB = await writeConfig(installB, 55446);
    const lines: string[] = [];

    await contactsShareLinkCommand(
      "meera",
      {
        config: configB,
        endpoint: "https://b.stacy.dev/api/federation",
        revocationUrl: "https://b.stacy.dev/api/federation/revocations",
        label: "Dr. Meera Patel / Eastside Specialty",
        expires: "10m",
        baseUrl: "https://stacy.dev/contacts/import",
        json: true,
      },
      {
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    const exported = JSON.parse(lines.at(-1) ?? "{}") as { link: string; expiresAt: string };
    expect(exported.link).toContain("https://stacy.dev/contacts/import?payload=");
    expect(exported.expiresAt).toBe("2026-05-22T00:10:00.000Z");

    await contactsImportLinkCommand(
      exported.link,
      { config: configA, as: "meera", json: true },
      {
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:05:00.000Z"),
      },
    );

    await expect(readContact(resolveContactsPath(installA), "meera")).resolves.toMatchObject({
      name: "meera",
      label: "Dr. Meera Patel / Eastside Specialty",
      federationEndpointUrl: "https://b.stacy.dev/api/federation",
    });
  });

  it("rejects expired contact share links before import", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-contact-link-"));
    tempRoots.push(root);
    const installA = join(root, "install-a");
    const installB = join(root, "install-b");
    await mkdir(installA, { recursive: true });
    await mkdir(installB, { recursive: true });
    const configA = await writeConfig(installA, 55447);
    const configB = await writeConfig(installB, 55448);
    const lines: string[] = [];

    await contactsShareLinkCommand(
      "meera",
      {
        config: configB,
        endpoint: "https://b.stacy.dev/api/federation",
        revocationUrl: "https://b.stacy.dev/api/federation/revocations",
        expires: "1m",
        json: true,
      },
      {
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );
    const exported = JSON.parse(lines.at(-1) ?? "{}") as { link: string };

    await expect(
      contactsImportLinkCommand(
        exported.link,
        { config: configA, as: "meera" },
        {
          stdout: { log: () => undefined },
          now: () => new Date("2026-05-22T00:02:00.000Z"),
        },
      ),
    ).rejects.toThrow("Contact share link has expired");
  });

  it("rejects contact share links with a tampered nested card", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-contact-link-"));
    tempRoots.push(root);
    const installA = join(root, "install-a");
    const installB = join(root, "install-b");
    await mkdir(installA, { recursive: true });
    await mkdir(installB, { recursive: true });
    const configA = await writeConfig(installA, 55449);
    const configB = await writeConfig(installB, 55450);
    const lines: string[] = [];

    await contactsShareLinkCommand(
      "meera",
      {
        config: configB,
        endpoint: "https://b.stacy.dev/api/federation",
        revocationUrl: "https://b.stacy.dev/api/federation/revocations",
        expires: "10m",
        json: true,
      },
      {
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );
    const exported = JSON.parse(lines.at(-1) ?? "{}") as { link: string };
    const tampered = tamperShareLink(exported.link, (payload) => {
      payload.signedPayload.card.signedPayload.federationEndpointUrl = "https://evil.example/api/federation";
    });

    await expect(
      contactsImportLinkCommand(
        tampered,
        { config: configA, as: "meera" },
        {
          stdout: { log: () => undefined },
          now: () => new Date("2026-05-22T00:05:00.000Z"),
        },
      ),
    ).rejects.toThrow("Contact share link signature verification failed");
  });

  it("handles duplicate contact share-link imports idempotently", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-contact-link-"));
    tempRoots.push(root);
    const installA = join(root, "install-a");
    const installB = join(root, "install-b");
    await mkdir(installA, { recursive: true });
    await mkdir(installB, { recursive: true });
    const configA = await writeConfig(installA, 55451);
    const configB = await writeConfig(installB, 55452);
    const lines: string[] = [];

    await contactsShareLinkCommand(
      "meera",
      {
        config: configB,
        endpoint: "https://b.stacy.dev/api/federation",
        revocationUrl: "https://b.stacy.dev/api/federation/revocations",
        label: "Dr. Meera Patel / Eastside Specialty",
        expires: "10m",
        json: true,
      },
      {
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );
    const exported = JSON.parse(lines.at(-1) ?? "{}") as { link: string };

    await contactsImportLinkCommand(
      exported.link,
      { config: configA, as: "meera", json: true },
      {
        stdout: { log: () => undefined },
        now: () => new Date("2026-05-22T00:05:00.000Z"),
      },
    );
    await contactsImportLinkCommand(
      exported.link,
      { config: configA, as: "meera", json: true },
      {
        stdout: { log: () => undefined },
        now: () => new Date("2026-05-22T00:05:30.000Z"),
      },
    );

    await expect(listContacts(resolveContactsPath(installA))).resolves.toHaveLength(1);
    await expect(readContact(resolveContactsPath(installA), "meera")).resolves.toMatchObject({
      name: "meera",
      label: "Dr. Meera Patel / Eastside Specialty",
      federationEndpointUrl: "https://b.stacy.dev/api/federation",
    });
  });
});

function tamperShareLink(
  link: string,
  mutate: (payload: Record<string, any>) => void,
): string {
  const url = new URL(link);
  const encoded = url.searchParams.get("payload");
  if (!encoded) throw new Error("Expected payload");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, any>;
  mutate(payload);
  url.searchParams.set("payload", Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"));
  return url.toString();
}

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
