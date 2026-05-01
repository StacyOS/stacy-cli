#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

function usage() {
  console.log([
    "Usage:",
    "  node scripts/smoke/stacy-cli-npm-smoke.mjs [--version <version>] [--expected-paperclip <version>] [--skip-runtime]",
    "",
    "Examples:",
    "  pnpm smoke:stacy-cli-npm",
    "  pnpm smoke:stacy-cli-npm -- --version 2026.428.0 --expected-paperclip 2026.428.0",
    "",
    "Environment:",
    "  STACY_CLI_EXPECTED_PAPERCLIP_VERSION  Expected paperclipai dependency/runtime version",
  ].join("\n"));
}

function parseArgs(args) {
  const options = {
    version: "",
    expectedPaperclip: process.env.STACY_CLI_EXPECTED_PAPERCLIP_VERSION ?? "",
    skipRuntime: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--version") {
      options.version = args[++index] ?? "";
      if (!options.version) throw new Error("--version requires a package version.");
      continue;
    }
    if (arg === "--expected-paperclip") {
      options.expectedPaperclip = args[++index] ?? "";
      if (!options.expectedPaperclip) throw new Error("--expected-paperclip requires a package version.");
      continue;
    }
    if (arg === "--skip-runtime") {
      options.skipRuntime = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  return options;
}

function commandEnv() {
  return {
    ...process.env,
    npm_config_cache: process.env.npm_config_cache || path.join(os.tmpdir(), "stacy-npm-cache"),
  };
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout ?? 30_000,
    env: commandEnv(),
  });
}

function requireOk(result, label) {
  if (result.status === 0) return;
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  throw new Error(`${label} failed${output ? `:\n${output}` : ""}`);
}

function npmJson(args, label) {
  const result = run("npm", args);
  requireOk(result, label);
  const trimmed = result.stdout.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

function normalizeVersionOutput(stdout) {
  return stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? "";
}

try {
  const options = parseArgs(process.argv.slice(2));
  const targetVersion =
    options.version ||
    npmJson(["view", "stacy-cli", "version", "--json"], "npm view stacy-cli version");

  if (!targetVersion || typeof targetVersion !== "string") {
    throw new Error("Could not resolve a stacy-cli package version to smoke.");
  }

  const meta = npmJson(
    ["view", `stacy-cli@${targetVersion}`, "name", "version", "dependencies", "bin", "--json"],
    `npm view stacy-cli@${targetVersion}`,
  );

  const dependencyVersion = meta?.dependencies?.paperclipai;
  if (!dependencyVersion || typeof dependencyVersion !== "string") {
    throw new Error(`stacy-cli@${targetVersion} does not declare a paperclipai dependency.`);
  }

  if (dependencyVersion.startsWith("workspace:")) {
    throw new Error(`stacy-cli@${targetVersion} published an invalid workspace dependency: ${dependencyVersion}`);
  }

  if (meta?.bin?.stacy !== "bin/stacy.js") {
    throw new Error(`stacy-cli@${targetVersion} does not expose the expected stacy binary.`);
  }

  const expectedPaperclip = options.expectedPaperclip || dependencyVersion;
  if (dependencyVersion !== expectedPaperclip) {
    throw new Error(
      `stacy-cli@${targetVersion} depends on paperclipai@${dependencyVersion}, expected ${expectedPaperclip}.`,
    );
  }

  const resolvedPaperclip = npmJson(
    ["view", `paperclipai@${dependencyVersion}`, "version", "--json"],
    `npm view paperclipai@${dependencyVersion}`,
  );
  if (resolvedPaperclip !== dependencyVersion) {
    throw new Error(`paperclipai@${dependencyVersion} is not resolvable from npm.`);
  }

  if (!options.skipRuntime) {
    const runtime = run(
      "npm",
      ["exec", "--yes", "--package", `stacy-cli@${targetVersion}`, "--", "stacy", "--version"],
      { timeout: 180_000 },
    );
    requireOk(runtime, `npm exec stacy-cli@${targetVersion}`);
    const runtimeVersion = normalizeVersionOutput(runtime.stdout);
    if (runtimeVersion !== expectedPaperclip) {
      throw new Error(
        `stacy-cli@${targetVersion} runtime printed ${runtimeVersion || "<empty>"}, expected ${expectedPaperclip}.`,
      );
    }
  }

  console.log(
    `PASS: stacy-cli@${targetVersion} wraps paperclipai@${dependencyVersion} and exposes stacy.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
