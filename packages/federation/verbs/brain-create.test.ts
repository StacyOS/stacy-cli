import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { brainCreateCommand } from "./brain-create.js";

const tempRoots: string[] = [];

describe("brainCreateCommand", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  it("creates a local signed KO and prints JSON metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-brain-create-"));
    tempRoots.push(root);
    const configPath = await writeConfig(root, 55445);
    const lines: string[] = [];
    const queries: unknown[] = [];

    await brainCreateCommand(
      {
        config: configPath,
        dbUrl: "postgres://example",
        contentJson: JSON.stringify({ title: "From CLI" }),
        koId: "ko_brain_create",
        json: true,
      },
      {
        createDb: () => ({
          execute: async (query) => {
            queries.push(query);
            return [];
          },
        }),
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    expect(queries.length).toBeGreaterThanOrEqual(13);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      id: "ko_brain_create",
      tenant: "stacy/acme",
      contentType: "application/json",
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  });

  it("creates a document KO from a local markdown file with a leak-safe source label", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-brain-create-file-"));
    tempRoots.push(root);
    const configPath = await writeConfig(root, 55446);
    const docPath = join(root, "notes.md");
    await writeFile(docPath, "# Release notes\n\nShip it.", "utf8");

    const lines: string[] = [];
    let storedContent: unknown;

    await brainCreateCommand(
      {
        config: configPath,
        dbUrl: "postgres://example",
        file: docPath,
        sourceLabel: "notes.md",
        koId: "ko_file_doc",
        json: true,
      },
      {
        createDb: () => ({
          execute: async (query: unknown) => {
            const text = JSON.stringify(query);
            if (text.includes("# Release notes")) storedContent = query;
            return [];
          },
        }),
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-06-02T00:00:00.000Z"),
      },
    );

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      id: "ko_file_doc",
      contentType: "application/json",
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    // The stored content is a document envelope with a relative (non-absolute)
    // source label — no leaked absolute path.
    const serialized = JSON.stringify(storedContent ?? "");
    expect(serialized).toContain("document"); // document envelope kind
    expect(serialized).toContain("notes.md"); // relative source label
    expect(serialized).not.toContain(root); // absolute path must not leak
  });

  it("creates one KO per file for directory ingest, excluding hidden/node_modules", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-brain-create-dir-"));
    tempRoots.push(root);
    const configPath = await writeConfig(root, 55447);
    const docs = join(root, "docs");
    await mkdir(join(docs, "node_modules"), { recursive: true });
    await writeFile(join(docs, "a.md"), "# a", "utf8");
    await writeFile(join(docs, "b.md"), "# b", "utf8");
    await writeFile(join(docs, "c.txt"), "c", "utf8");
    await writeFile(join(docs, ".secret.md"), "leak", "utf8");
    await writeFile(join(docs, "node_modules", "d.md"), "# d", "utf8");

    const lines: string[] = [];
    const summaries: string[] = [];

    await brainCreateCommand(
      {
        config: configPath,
        dbUrl: "postgres://example",
        dir: docs,
        ext: "md",
        json: true,
      },
      {
        createDb: () => ({ execute: async () => [] }),
        stdout: { log: (line) => lines.push(line) },
        confirm: async (summary) => {
          summaries.push(summary);
          return true;
        },
        now: () => new Date("2026-06-02T00:00:00.000Z"),
      },
    );

    const out = JSON.parse(lines[0] ?? "{}");
    // a.md + b.md only (.secret.md hidden, node_modules excluded, c.txt wrong ext)
    expect(out.created).toHaveLength(2);
    const sources = out.created.map((c: { source: string }) => c.source).sort();
    expect(sources.every((s: string) => s.endsWith(".md"))).toBe(true);
    expect(JSON.stringify(out)).not.toContain(".secret");
    expect(JSON.stringify(out)).not.toContain("node_modules");
  });

  it("skips unreadable (binary) files in a directory batch without aborting", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-brain-create-dir-skip-"));
    tempRoots.push(root);
    const configPath = await writeConfig(root, 55448);
    const docs = join(root, "docs");
    await mkdir(docs, { recursive: true });
    await writeFile(join(docs, "good.md"), "# good", "utf8");
    await writeFile(join(docs, "bin.md"), Buffer.from([0x68, 0x00, 0x69])); // NUL = binary

    const lines: string[] = [];
    await brainCreateCommand(
      {
        config: configPath,
        dbUrl: "postgres://example",
        dir: docs,
        yes: true,
        json: true,
      },
      {
        createDb: () => ({ execute: async () => [] }),
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-06-02T00:00:00.000Z"),
      },
    );

    const out = JSON.parse(lines[0] ?? "{}");
    expect(out.created).toHaveLength(1);
    expect(out.created[0].source).toContain("good.md");
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].reason).toMatch(/binary/);
  });

  it("rejects passing more than one content source", async () => {
    await expect(
      brainCreateCommand(
        {
          dbUrl: "postgres://example",
          contentJson: "{}",
          file: "/tmp/x.md",
        },
        {
          createDb: () => ({ execute: async () => [] }),
          stdout: { log: () => undefined },
        },
      ),
    ).rejects.toThrow(/exactly one of/);
  });

  it("rejects invalid JSON content before opening the database", async () => {
    const openedConnections: string[] = [];

    await expect(
      brainCreateCommand(
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
