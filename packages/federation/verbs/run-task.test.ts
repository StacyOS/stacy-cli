import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runTaskCommand } from "./run-task.js";

const tempRoots: string[] = [];

describe("runTaskCommand", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("creates a deterministic dashboard KO from CSV input", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-run-task-"));
    tempRoots.push(root);
    const csvPath = await writeCsv(root);
    const lines: string[] = [];

    await runTaskCommand(
      "build a quarterly revenue dashboard from this CSV",
      {
        dbUrl: "postgres://example",
        input: csvPath,
        koId: "ko_run_task",
        json: true,
      },
      {
        cwd: root,
        createDb: () => ({ execute: async () => [] }),
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      id: "ko_run_task",
      generator: "deterministic_dashboard",
      input: {
        fileName: "input.csv",
        rows: 2,
      },
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  });

  it("can use an adapter command while preserving the signed KO path", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-run-task-"));
    tempRoots.push(root);
    const csvPath = await writeCsv(root);
    const lines: string[] = [];

    await runTaskCommand(
      "summarize this CSV",
      {
        dbUrl: "postgres://example",
        input: csvPath,
        adapterCommand: process.execPath,
        adapterArg: ["-e", "process.stdin.pipe(process.stdout)"],
        koId: "ko_adapter_task",
        json: true,
      },
      {
        cwd: root,
        createDb: () => ({ execute: async () => [] }),
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      id: "ko_adapter_task",
      generator: "adapter_command",
      input: {
        fileName: "input.csv",
        rows: 2,
      },
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  });

  it("accepts a dashboard schema for non-Acme CSV columns", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-run-task-"));
    tempRoots.push(root);
    const csvPath = join(root, "usage.csv");
    const schemaPath = join(root, "usage.schema.json");
    await writeFile(csvPath, [
      "week,signups,activation_rate",
      "2026-W20,12,0.4",
      "2026-W21,18,0.5",
    ].join("\n"), "utf8");
    await writeFile(schemaPath, JSON.stringify({
      title: "Usage Dashboard",
      widgets: [
        { kind: "metric", label: "Signups", column: "signups", aggregate: "sum", format: "number" },
        { kind: "metric", label: "Activation", column: "activation_rate", aggregate: "average", format: "percent" },
      ],
    }), "utf8");
    const lines: string[] = [];

    await runTaskCommand(
      "build usage dashboard",
      {
        dbUrl: "postgres://example",
        input: csvPath,
        schema: schemaPath,
        koId: "ko_schema_task",
        json: true,
      },
      {
        cwd: root,
        createDb: () => ({ execute: async () => [] }),
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      id: "ko_schema_task",
      input: {
        fileName: "usage.csv",
        rows: 2,
      },
      generator: "deterministic_dashboard",
    });
  });

  it("rejects an invalid dashboard schema before creating the KO", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-run-task-"));
    tempRoots.push(root);
    const csvPath = await writeCsv(root);
    const schemaPath = join(root, "bad.schema.json");
    await writeFile(schemaPath, JSON.stringify({ widgets: [] }), "utf8");
    const openedConnections: string[] = [];

    await expect(
      runTaskCommand(
        "build dashboard",
        {
          dbUrl: "postgres://example",
          input: csvPath,
          schema: schemaPath,
          json: true,
        },
        {
          cwd: root,
          createDb: (connectionString) => {
            openedConnections.push(connectionString);
            return { execute: async () => [] };
          },
          stdout: { log: () => undefined },
        },
      ),
    ).rejects.toThrow("Dashboard schema must include a non-empty widgets array.");

    expect(openedConnections).toEqual([]);
  });
});

async function writeCsv(root: string): Promise<string> {
  const csvPath = join(root, "input.csv");
  await writeFile(
    csvPath,
    [
      "month,revenue,pipeline,active_customers,churn_risk",
      "2026-04,100,200,10,0.1",
      "2026-05,150,250,12,0.2",
    ].join("\n"),
    "utf8",
  );
  return csvPath;
}
