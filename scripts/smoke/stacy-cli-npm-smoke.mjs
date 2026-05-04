#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const CORE_PACKAGE_NAME = "@arpanstacy/stacy";

function usage() {
  console.log([
    "Usage:",
    "  node scripts/smoke/stacy-cli-npm-smoke.mjs [--version <version>] [--expected-core <version>] [--skip-runtime]",
    "",
    "Examples:",
    "  pnpm smoke:stacy-cli-npm",
    "  pnpm smoke:stacy-cli-npm -- --version 2026.501.0 --expected-core 2026.501.0",
    "",
    "Environment:",
    "  STACY_CLI_EXPECTED_CORE_VERSION  Expected Stacy core dependency/runtime version",
  ].join("\n"));
}

function parseArgs(args) {
  const options = {
    version: "",
    expectedCore: process.env.STACY_CLI_EXPECTED_CORE_VERSION ?? "",
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
    if (arg === "--expected-core") {
      options.expectedCore = args[++index] ?? "";
      if (!options.expectedCore) throw new Error("--expected-core requires a package version.");
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

  const dependencyVersion = meta?.dependencies?.[CORE_PACKAGE_NAME];
  if (!dependencyVersion || typeof dependencyVersion !== "string") {
    throw new Error(`stacy-cli@${targetVersion} does not declare a ${CORE_PACKAGE_NAME} dependency.`);
  }

  if (dependencyVersion.startsWith("workspace:")) {
    throw new Error(`stacy-cli@${targetVersion} published an invalid workspace dependency: ${dependencyVersion}`);
  }

  if (meta?.bin?.stacy !== "bin/stacy.js") {
    throw new Error(`stacy-cli@${targetVersion} does not expose the expected stacy binary.`);
  }

  const expectedCore = options.expectedCore || dependencyVersion;
  if (dependencyVersion !== expectedCore) {
    throw new Error(
      `stacy-cli@${targetVersion} depends on ${CORE_PACKAGE_NAME}@${dependencyVersion}, expected ${expectedCore}.`,
    );
  }

  const resolvedCore = npmJson(
    ["view", `${CORE_PACKAGE_NAME}@${dependencyVersion}`, "version", "--json"],
    `npm view ${CORE_PACKAGE_NAME}@${dependencyVersion}`,
  );
  if (resolvedCore !== dependencyVersion) {
    throw new Error(`${CORE_PACKAGE_NAME}@${dependencyVersion} is not resolvable from npm.`);
  }

  if (!options.skipRuntime) {
    const runtime = run(
      "npm",
      ["exec", "--yes", "--package", `stacy-cli@${targetVersion}`, "--", "stacy", "--version"],
      { timeout: 180_000 },
    );
    requireOk(runtime, `npm exec stacy-cli@${targetVersion}`);
    const runtimeVersion = normalizeVersionOutput(runtime.stdout);
    if (runtimeVersion !== expectedCore) {
      throw new Error(
        `stacy-cli@${targetVersion} runtime printed ${runtimeVersion || "<empty>"}, expected ${expectedCore}.`,
      );
    }
  }

  console.log(
    `PASS: stacy-cli@${targetVersion} wraps ${CORE_PACKAGE_NAME}@${dependencyVersion} and exposes stacy.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
