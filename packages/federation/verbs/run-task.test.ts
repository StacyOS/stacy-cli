import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
        ackEgress: true,
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

  it("accepts schema-validated adapter dashboard JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-run-task-"));
    tempRoots.push(root);
    const csvPath = await writeCsv(root);
    const lines: string[] = [];
    const createdContents: unknown[] = [];

    await runTaskCommand(
      "summarize this CSV",
      {
        dbUrl: "postgres://example",
        input: csvPath,
        adapterCommand: process.execPath,
        adapterArg: ["-e", [
          "process.stdout.write(JSON.stringify({",
          "title:'Adapter Owned Dashboard',",
          "summary:'Adapter generated the widget contract.',",
          "widgets:[{kind:'metric',label:'Adapter Revenue',value:'$250'}],",
          "notes:['Adapter JSON validated.']",
          "}))",
        ].join("")],
        adapterOutput: "json",
        ackEgress: true,
        koId: "ko_adapter_json_task",
        json: true,
      },
      {
        cwd: root,
        createDb: () => ({
          execute: async (query) => {
            const signedPayload = extractSignedPayloadJson(query);
            if (signedPayload?.content) {
              createdContents.push(signedPayload.content);
            }
            return [];
          },
        }),
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      id: "ko_adapter_json_task",
      generator: "adapter_command",
    });
    expect(createdContents[0]).toMatchObject({
      title: "Adapter Owned Dashboard",
      summary: "Adapter generated the widget contract.",
      widgets: [{ kind: "metric", label: "Adapter Revenue", value: "$250" }],
      adapterNotes: ["Adapter JSON validated."],
    });
  });

  it("redacts selected columns from adapter stdin while recording KO redaction metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-run-task-"));
    tempRoots.push(root);
    const csvPath = join(root, "customers.csv");
    const adapterInputPath = join(root, "adapter-input.json");
    await writeFile(csvPath, [
      "customer_email,revenue,notes",
      "a@example.com,100,keep",
      "b@example.com,150,also keep",
    ].join("\n"), "utf8");
    const lines: string[] = [];
    const createdContents: unknown[] = [];

    await runTaskCommand(
      "summarize customer revenue",
      {
        dbUrl: "postgres://example",
        input: csvPath,
        adapterCommand: process.execPath,
        adapterArg: ["-e", [
          "const fs=require('node:fs');",
          "let input='';",
          "process.stdin.on('data',c=>input+=c);",
          "process.stdin.on('end',()=>{",
          `fs.writeFileSync(${JSON.stringify(adapterInputPath)},input);`,
          "process.stdout.write(JSON.stringify({widgets:[{kind:'metric',label:'Revenue',value:250}]}));",
          "});",
        ].join("")],
        adapterOutput: "json",
        redactColumn: ["customer_email"],
        ackEgress: true,
        koId: "ko_redacted_adapter_task",
        json: true,
      },
      {
        cwd: root,
        createDb: () => ({
          execute: async (query) => {
            const signedPayload = extractSignedPayloadJson(query);
            if (signedPayload?.content) {
              createdContents.push(signedPayload.content);
            }
            return [];
          },
        }),
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    const adapterInput = JSON.parse(await readFile(adapterInputPath, "utf8")) as {
      readonly input: { readonly columns: readonly string[]; readonly records: readonly Record<string, string>[] };
      readonly redactedColumns: readonly string[];
    };
    expect(adapterInput.redactedColumns).toEqual(["customer_email"]);
    expect(adapterInput.input.columns).toEqual(["revenue", "notes"]);
    expect(adapterInput.input.records).toEqual([
      { revenue: "100", notes: "keep" },
      { revenue: "150", notes: "also keep" },
    ]);
    expect(JSON.stringify(adapterInput)).not.toContain("a@example.com");

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      id: "ko_redacted_adapter_task",
      redactedColumns: ["customer_email"],
      input: {
        fileName: "customers.csv",
        rows: 2,
      },
    });
    expect(createdContents[0]).toMatchObject({
      redactedColumns: ["customer_email"],
      input: {
        fileName: "customers.csv",
        rows: 2,
      },
    });
  });

  it("supports STACY_PUBLIC_DEMO_REDACT_COLUMNS for adapter redaction", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-run-task-"));
    tempRoots.push(root);
    const csvPath = join(root, "customers.csv");
    const adapterInputPath = join(root, "adapter-input-env.json");
    await writeFile(csvPath, [
      "customer_email,revenue",
      "a@example.com,100",
    ].join("\n"), "utf8");

    await runTaskCommand(
      "summarize customer revenue",
      {
        dbUrl: "postgres://example",
        input: csvPath,
        adapterCommand: process.execPath,
        adapterArg: ["-e", [
          "const fs=require('node:fs');let input='';",
          "process.stdin.on('data',c=>input+=c);",
          "process.stdin.on('end',()=>{",
          `fs.writeFileSync(${JSON.stringify(adapterInputPath)},input);`,
          "process.stdout.write('ok');",
          "});",
        ].join("")],
        ackEgress: true,
        koId: "ko_env_redacted_adapter_task",
        json: true,
      },
      {
        cwd: root,
        env: { STACY_PUBLIC_DEMO_REDACT_COLUMNS: "customer_email" },
        createDb: () => ({ execute: async () => [] }),
        stdout: { log: () => undefined },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    const adapterInput = JSON.parse(await readFile(adapterInputPath, "utf8")) as {
      readonly input: { readonly records: readonly Record<string, string>[] };
      readonly redactedColumns: readonly string[];
    };
    expect(adapterInput.redactedColumns).toEqual(["customer_email"]);
    expect(adapterInput.input.records).toEqual([{ revenue: "100" }]);
  });

  it("rejects invalid adapter dashboard JSON before creating the KO", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-run-task-"));
    tempRoots.push(root);
    const csvPath = await writeCsv(root);
    const openedConnections: string[] = [];

    await expect(
      runTaskCommand(
        "summarize this CSV",
        {
          dbUrl: "postgres://example",
          input: csvPath,
          adapterCommand: process.execPath,
          adapterArg: ["-e", "process.stdout.write(JSON.stringify({widgets:[{kind:'metric',label:'Revenue'}]}))"],
          adapterOutput: "json",
          ackEgress: true,
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
    ).rejects.toThrow("must include a string or number value");

    expect(openedConnections).toEqual([]);
  });

  it("rejects unsupported adapter output modes before spawning the adapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-run-task-"));
    tempRoots.push(root);
    const csvPath = await writeCsv(root);

    await expect(
      runTaskCommand(
        "summarize this CSV",
        {
          dbUrl: "postgres://example",
          input: csvPath,
          adapterCommand: process.execPath,
          adapterArg: ["-e", "process.exit(0)"],
          adapterOutput: "yaml",
          ackEgress: true,
          json: true,
        },
        {
          cwd: root,
          createDb: () => ({ execute: async () => [] }),
          stdout: { log: () => undefined },
        },
      ),
    ).rejects.toThrow("--adapter-output must be either text or json.");
  });

  it("allows adapter commands listed in STACY_PUBLIC_DEMO_ALLOWED_ADAPTERS", async () => {
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
        adapterArg: ["-e", "console.log('allowed adapter')"],
        ackEgress: true,
        koId: "ko_allowed_adapter_task",
        json: true,
      },
      {
        cwd: root,
        env: { STACY_PUBLIC_DEMO_ALLOWED_ADAPTERS: "node" },
        createDb: () => ({ execute: async () => [] }),
        stdout: { log: (line) => lines.push(line) },
        now: () => new Date("2026-05-22T00:00:00.000Z"),
      },
    );

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      id: "ko_allowed_adapter_task",
      generator: "adapter_command",
    });
  });

  it("rejects adapter commands outside STACY_PUBLIC_DEMO_ALLOWED_ADAPTERS before creating the KO", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-run-task-"));
    tempRoots.push(root);
    const csvPath = await writeCsv(root);
    const openedConnections: string[] = [];

    await expect(
      runTaskCommand(
        "summarize this CSV",
        {
          dbUrl: "postgres://example",
          input: csvPath,
          adapterCommand: process.execPath,
          adapterArg: ["-e", "console.log('should not run')"],
          ackEgress: true,
          json: true,
        },
        {
          cwd: root,
          env: { STACY_PUBLIC_DEMO_ALLOWED_ADAPTERS: "claude,codex" },
          createDb: (connectionString) => {
            openedConnections.push(connectionString);
            return { execute: async () => [] };
          },
          stdout: { log: () => undefined },
        },
      ),
    ).rejects.toThrow('Adapter command "node" is not allowed.');

    expect(openedConnections).toEqual([]);
  });

  it("requires explicit egress acknowledgement before sending input to an adapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-run-task-"));
    tempRoots.push(root);
    const csvPath = await writeCsv(root);
    const openedConnections: string[] = [];

    await expect(
      runTaskCommand(
        "summarize this CSV",
        {
          dbUrl: "postgres://example",
          input: csvPath,
          adapterCommand: process.execPath,
          adapterArg: ["-e", "console.log('should not run')"],
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
    ).rejects.toThrow("Adapter execution may send input records outside this install. Re-run with --ack-egress to confirm.");

    expect(openedConnections).toEqual([]);
  });

  it("times out a slow adapter before creating the KO", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-run-task-"));
    tempRoots.push(root);
    const csvPath = await writeCsv(root);
    const openedConnections: string[] = [];

    await expect(
      runTaskCommand(
        "summarize slowly",
        {
          dbUrl: "postgres://example",
          input: csvPath,
          adapterCommand: process.execPath,
          adapterArg: ["-e", "setTimeout(() => console.log('too late'), 5000)"],
          adapterTimeoutMs: 25,
          ackEgress: true,
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
    ).rejects.toThrow("Adapter command timed out after 25ms");

    expect(openedConnections).toEqual([]);
  });

  it("rejects invalid adapter timeout values before spawning the adapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-run-task-"));
    tempRoots.push(root);
    const csvPath = await writeCsv(root);

    await expect(
      runTaskCommand(
        "summarize this CSV",
        {
          dbUrl: "postgres://example",
          input: csvPath,
          adapterCommand: process.execPath,
          adapterArg: ["-e", "process.exit(0)"],
          adapterTimeoutMs: "0",
          ackEgress: true,
          json: true,
        },
        {
          cwd: root,
          createDb: () => ({ execute: async () => [] }),
          stdout: { log: () => undefined },
        },
      ),
    ).rejects.toThrow("--adapter-timeout-ms must be a positive integer.");
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

function extractSignedPayloadJson(query: unknown): { readonly content?: unknown } | null {
  const chunks = (query as { readonly queryChunks?: readonly unknown[] }).queryChunks ?? [];
  for (const chunk of chunks) {
    if (typeof chunk === "string") {
      try {
        return JSON.parse(chunk) as { readonly content?: unknown };
      } catch {
        // keep scanning parameter chunks
      }
    }
  }
  return null;
}

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
