#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(repoRoot, "packages", "stacy-cli", "package.json");
const npmCache = process.env.npm_config_cache || path.join(os.tmpdir(), "stacy-npm-cache");

function usage() {
  console.log([
    "Usage:",
    "  node scripts/phase5-release-gate.mjs [--strict-live] [--skip-network] [--skip-dry-run]",
    "",
    "Runs the Phase 5 distribution gate. The default gate is read-only and treats",
    "an unpublished stacy-cli correction as auth-gated, not a local failure.",
    "",
    "Options:",
    "  --strict-live   Fail when stacy-cli@<local version> is not live or 0.3.1 is active.",
    "  --skip-network  Run only local syntax/package checks.",
    "  --skip-dry-run  Skip the npm publish dry run.",
  ].join("\n"));
}

function parseArgs(args) {
  const options = {
    strictLive: false,
    skipNetwork: false,
    skipDryRun: false,
  };

  for (const arg of args) {
    if (arg === "--") continue;
    if (arg === "--strict-live") {
      options.strictLive = true;
      continue;
    }
    if (arg === "--skip-network") {
      options.skipNetwork = true;
      continue;
    }
    if (arg === "--skip-dry-run") {
      options.skipDryRun = true;
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
    npm_config_cache: npmCache,
  };
}

function run(command, args, options = {}) {
  console.log(`==> ${options.label ?? [command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout: options.timeout ?? 120_000,
    env: commandEnv(),
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${output ? `:\n${output}` : ""}`);
  }

  return result;
}

function npmJson(args, label) {
  const result = run("npm", args, { capture: true, label, timeout: 30_000 });
  const trimmed = result.stdout.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

function npmMaybeJson(args, label) {
  const result = spawnSync("npm", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    env: commandEnv(),
  });

  if (result.status !== 0) return null;
  const trimmed = result.stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function registryState(targetVersion) {
  const live = npmJson(
    ["view", "stacy-cli", "versions", "dist-tags", "dependencies", "--json"],
    "read stacy-cli registry state",
  );
  const versions = Array.isArray(live?.versions) ? live.versions : [];
  const latest = live?.["dist-tags"]?.latest ?? "unknown";
  const latestPaperclip = live?.dependencies?.paperclipai ?? "unknown";
  const oldDeprecated = npmMaybeJson(
    ["view", "stacy-cli@0.3.1", "deprecated", "--json"],
    "read stacy-cli@0.3.1 deprecation state",
  );

  return {
    latest,
    latestPaperclip,
    oldActive: versions.includes("0.3.1") && typeof oldDeprecated !== "string",
    targetLive: versions.includes(targetVersion),
  };
}

function resolvePaperclipPublishVersion(pkg) {
  const paperclipVersion = pkg.dependencies?.paperclipai;
  if (!paperclipVersion || typeof paperclipVersion !== "string") {
    throw new Error("stacy-cli must depend on paperclipai.");
  }
  if (paperclipVersion.startsWith("workspace:")) {
    return pkg.version;
  }
  if (paperclipVersion !== pkg.version) {
    throw new Error(`stacy-cli@${pkg.version} must wrap matching paperclipai@${pkg.version}; found ${paperclipVersion}.`);
  }
  return paperclipVersion;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  const targetVersion = pkg.version;

  if (pkg.name !== "stacy-cli") {
    throw new Error(`Expected package name stacy-cli, found ${pkg.name}.`);
  }
  if (!targetVersion || typeof targetVersion !== "string") {
    throw new Error("packages/stacy-cli/package.json must define a string version.");
  }
  const paperclipVersion = resolvePaperclipPublishVersion(pkg);

  console.log("Phase 5 release gate");
  console.log(`target wrapper: stacy-cli@${targetVersion} -> paperclipai@${paperclipVersion}`);

  run("node", ["--check", "scripts/publish-stacy-cli.mjs"], { label: "check stacy-cli publish helper" });
  run("node", ["--check", "scripts/smoke/stacy-cli-npm-smoke.mjs"], { label: "check stacy-cli npm smoke" });
  run("pnpm", ["--filter", "stacy-cli", "build"], { label: "build stacy-cli wrapper" });

  if (options.skipNetwork) {
    console.log("SKIP: network checks were skipped.");
    console.log("PASS: local Phase 5 gate passed.");
    process.exit(0);
  }

  run("pnpm", ["release:package-name"], { label: "confirm stacy-cli package ownership" });
  run("pnpm", ["release:stacy-cli:status"], { label: "inspect stacy-cli live status" });

  if (!options.skipDryRun) {
    run("pnpm", ["release:stacy-cli"], { label: "dry-run stacy-cli publish", timeout: 180_000 });
  }

  const state = registryState(targetVersion);
  console.log("==> Phase 5 registry summary");
  console.log(`target live: ${state.targetLive ? "yes" : "no"}`);
  console.log(`npm latest:  stacy-cli@${state.latest} -> paperclipai@${state.latestPaperclip}`);
  console.log(`old 0.3.1:   ${state.oldActive ? "active" : "not active or deprecated"}`);

  if (!state.targetLive || state.oldActive) {
    console.log("AUTH_GATED: run pnpm release:stacy-cli:publish -- --otp <fresh-code>");
    console.log("TOKEN_PATH: set NPM_TOKEN or NODE_AUTH_TOKEN, then run pnpm release:stacy-cli:publish");
    if (options.strictLive) {
      throw new Error("Phase 5 strict-live gate failed because npm still needs publish/deprecate auth.");
    }
  }

  console.log("PASS: Phase 5 release gate completed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
