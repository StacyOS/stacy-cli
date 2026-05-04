#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execute as executeClaude } from "../../packages/adapters/claude-local/src/server/execute.js";
import { execute as executeCodex } from "../../packages/adapters/codex-local/src/server/execute.js";
import type { AdapterExecutionResult } from "../../packages/adapter-utils/src/index.js";

type AdapterKey = "codex" | "claude";
type SmokeMode = "preflight" | "real";

interface CliOptions {
  adapters: AdapterKey[];
  mode: SmokeMode;
  allowBilling: boolean;
}

const ADAPTERS = new Set<AdapterKey>(["codex", "claude"]);
const TRUE_VALUES = new Set(["1", "true", "yes", "y"]);

function printHelp() {
  console.log([
    "Usage: pnpm smoke:codex-local-real",
    "       pnpm smoke:claude-local-real",
    "       pnpm smoke:phase4-local-adapters",
    "       pnpm smoke:codex-local-preflight",
    "       pnpm smoke:claude-local-preflight",
    "       pnpm smoke:phase4-local-adapters-preflight",
    "",
    "Runs a real local Codex or Claude adapter smoke against the installed CLI.",
    "Real runs require STACY_REAL_SMOKE_ALLOW_BILLING=1 because they can use authenticated accounts and billable API usage.",
    "",
    "Environment overrides:",
    "  STACY_CODEX_COMMAND      Codex CLI command path, default: codex",
    "  STACY_CLAUDE_COMMAND     Claude CLI command path, default: claude",
    "  STACY_CODEX_MODEL        Optional Codex model",
    "  STACY_CLAUDE_MODEL       Optional Claude model",
    "  STACY_SMOKE_TIMEOUT_SEC  Adapter timeout, default: 90",
    "  STACY_REAL_SMOKE_ALLOW_BILLING=1  Required for real CLI invocation",
  ].join("\n"));
}

function readBooleanEnv(name: string): boolean {
  return TRUE_VALUES.has((process.env[name] ?? "").trim().toLowerCase());
}

function readCliOptions(args: string[]): CliOptions {
  if (args.length === 0 || args.some((arg) => arg === "-h" || arg === "--help")) {
    printHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const adapters: AdapterKey[] = [];
  let mode: SmokeMode = "real";
  let allowBilling = readBooleanEnv("STACY_REAL_SMOKE_ALLOW_BILLING") || readBooleanEnv("STACY_SMOKE_ALLOW_BILLING");
  for (const arg of args) {
    if (arg === "--preflight") {
      mode = "preflight";
      continue;
    }
    if (arg === "--allow-billing") {
      allowBilling = true;
      continue;
    }
    if (!ADAPTERS.has(arg as AdapterKey)) {
      throw new Error(`Unknown argument "${arg}". Expected codex, claude, --preflight, or --allow-billing.`);
    }
    adapters.push(arg as AdapterKey);
  }
  if (adapters.length === 0) {
    throw new Error("No adapters selected. Expected codex or claude.");
  }
  return { adapters, mode, allowBilling };
}

function readTimeoutSec(): number {
  const raw = process.env.STACY_SMOKE_TIMEOUT_SEC ?? "";
  if (!raw.trim()) return 90;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid STACY_SMOKE_TIMEOUT_SEC: ${raw}`);
  }
  return parsed;
}

function resolveAdapterCommand(adapter: AdapterKey): string {
  return adapter === "codex"
    ? process.env.STACY_CODEX_COMMAND ?? process.env.STACY_CODEX_COMMAND ?? "codex"
    : process.env.STACY_CLAUDE_COMMAND ?? process.env.STACY_CLAUDE_COMMAND ?? "claude";
}

function resolveAdapterModel(adapter: AdapterKey): string | undefined {
  return adapter === "codex" ? process.env.STACY_CODEX_MODEL : process.env.STACY_CLAUDE_MODEL;
}

function runVersionProbe(adapter: AdapterKey, command: string, cwd: string): boolean {
  const result = spawnSync(command, ["--version"], {
    cwd,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    console.error(`[smoke:${adapter}-local-real] command probe failed: ${result.error.message}`);
    return false;
  }

  const output = [result.stdout, result.stderr]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  if ((result.status ?? 1) !== 0) {
    console.error(`[smoke:${adapter}-local-real] ${command} --version exited with ${result.status ?? "unknown"}.`);
    if (output) console.error(`[smoke:${adapter}-local-real] version output: ${output}`);
    return false;
  }

  console.log(`[smoke:${adapter}-local-real] version=${output || "unknown"}`);
  return true;
}

function hasLikelyAuth(adapter: AdapterKey): boolean {
  if (adapter === "codex") {
    if ((process.env.OPENAI_API_KEY ?? "").trim()) return true;
    if ((process.env.CODEX_HOME ?? "").trim()) return true;
    return false;
  }

  if ((process.env.ANTHROPIC_API_KEY ?? "").trim()) return true;
  if ((process.env.CLAUDE_CONFIG_DIR ?? "").trim()) return true;
  return false;
}

function runPreflight(adapter: AdapterKey, command: string, workspace: string): boolean {
  console.log(`[smoke:${adapter}-local-real] preflight=non-billable`);
  console.log(`[smoke:${adapter}-local-real] workspace=${workspace}`);
  console.log(`[smoke:${adapter}-local-real] command=${command}`);
  const commandOk = runVersionProbe(adapter, command, workspace);
  const authLikely = hasLikelyAuth(adapter);
  console.log(
    `[smoke:${adapter}-local-real] auth_hint=${authLikely ? "configured" : "not-detected"} ` +
      "(real smoke is the source of truth)",
  );
  return commandOk;
}

function formatUsage(result: AdapterExecutionResult): string {
  const usage = result.usage;
  if (!usage) return "usage=unknown";
  return `usage=input:${usage.inputTokens} cached:${usage.cachedInputTokens} output:${usage.outputTokens}`;
}

function formatCost(result: AdapterExecutionResult): string {
  return result.costUsd == null ? "cost=unknown" : `cost=$${result.costUsd.toFixed(6)}`;
}

async function runAdapterSmoke(adapter: AdapterKey) {
  const testRoot = mkdtempSync(path.join(os.tmpdir(), `stacy-${adapter}-real-smoke-`));
  const workspace = path.join(testRoot, "workspace");
  const stacyHome = path.join(testRoot, "stacy-home");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(stacyHome, { recursive: true });
  writeFileSync(
    path.join(workspace, "README.md"),
    [
      `# Stacy ${adapter} real smoke workspace`,
      "",
      "This temporary workspace is created by the Phase 4 local adapter smoke.",
      "The agent prompt asks the CLI to reply only; it should not edit files.",
      "",
    ].join("\n"),
    "utf8",
  );

  const previousStacyHome = process.env.STACY_HOME;
  const previousStacyInstanceId = process.env.STACY_INSTANCE_ID;
  process.env.STACY_HOME = stacyHome;
  process.env.STACY_INSTANCE_ID = `phase4-${adapter}-real-smoke-${process.pid}`;

  const marker = adapter === "codex" ? "STACY_CODEX_REAL_SMOKE_OK" : "STACY_CLAUDE_REAL_SMOKE_OK";
  const command = resolveAdapterCommand(adapter);
  const model = resolveAdapterModel(adapter);
  const timeoutSec = readTimeoutSec();
  const execute = adapter === "codex" ? executeCodex : executeClaude;
  const logs: string[] = [];

  try {
    console.log(`[smoke:${adapter}-local-real] workspace=${workspace}`);
    console.log(`[smoke:${adapter}-local-real] command=${command}`);
    console.log(`[smoke:${adapter}-local-real] marker=${marker}`);

    const result = await execute({
      runId: `phase4-${adapter}-real-smoke`,
      agent: {
        id: `phase4-${adapter}-agent`,
        companyId: "phase4-real-smoke-company",
        name: adapter === "codex" ? "Codex Real Smoke" : "Claude Real Smoke",
        adapterType: adapter === "codex" ? "codex_local" : "claude_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command,
        cwd: workspace,
        timeoutSec,
        graceSec: 5,
        ...(model ? { model } : {}),
        ...(adapter === "claude" ? { dangerouslySkipPermissions: false, maxTurnsPerRun: 1 } : {}),
        promptTemplate: [
          `Reply exactly with ${marker}.`,
          "Do not edit files.",
          "Do not run tools.",
          "Do not include any other text.",
        ].join(" "),
      },
      context: {},
      onLog: async (stream, chunk) => {
        logs.push(chunk);
        process[stream === "stderr" ? "stderr" : "stdout"].write(chunk);
      },
    });

    const summary = result.summary ?? "";
    const resultJson = JSON.stringify(result.resultJson ?? {});
    const combined = `${summary}\n${resultJson}\n${logs.join("")}`;
    const ok = (result.exitCode ?? 1) === 0 && !result.errorMessage && combined.includes(marker);
    console.log(
      `[smoke:${adapter}-local-real] result exit=${result.exitCode ?? "null"} session=${result.sessionDisplayId ?? result.sessionId ?? "none"} ${formatUsage(result)} ${formatCost(result)}`,
    );

    if (!ok) {
      console.error(`[smoke:${adapter}-local-real] Expected marker ${marker}, but the run did not produce it.`);
      if (result.errorMessage) console.error(`[smoke:${adapter}-local-real] error=${result.errorMessage}`);
      process.exitCode = 1;
    }
  } finally {
    if (previousStacyHome === undefined) {
      delete process.env.STACY_HOME;
    } else {
      process.env.STACY_HOME = previousStacyHome;
    }
    if (previousStacyInstanceId === undefined) {
      delete process.env.STACY_INSTANCE_ID;
    } else {
      process.env.STACY_INSTANCE_ID = previousStacyInstanceId;
    }
  }
}

async function run(adapter: AdapterKey, options: CliOptions) {
  const testRoot = mkdtempSync(path.join(os.tmpdir(), `stacy-${adapter}-real-smoke-preflight-`));
  const workspace = path.join(testRoot, "workspace");
  mkdirSync(workspace, { recursive: true });
  const command = resolveAdapterCommand(adapter);
  const preflightOk = runPreflight(adapter, command, workspace);
  if (!preflightOk) {
    process.exitCode = 1;
    return;
  }

  if (options.mode === "preflight") return;

  if (!options.allowBilling) {
    console.error(
      `[smoke:${adapter}-local-real] Refusing to invoke the real CLI without STACY_REAL_SMOKE_ALLOW_BILLING=1.`,
    );
    console.error(
      `[smoke:${adapter}-local-real] Re-run with STACY_REAL_SMOKE_ALLOW_BILLING=1 once you are ready to spend local account/API usage.`,
    );
    process.exitCode = 1;
    return;
  }

  await runAdapterSmoke(adapter);
}

const options = readCliOptions(process.argv.slice(2));
for (const adapter of options.adapters) {
  await run(adapter, options);
}
