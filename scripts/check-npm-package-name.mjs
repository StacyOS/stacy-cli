#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function usage() {
  console.log([
    "Usage:",
    "  node scripts/check-npm-package-name.mjs [package-name] [--expected-owner <npm-user>] [--json] [--allow-taken]",
    "",
    "Examples:",
    "  pnpm release:package-name",
    "  node scripts/check-npm-package-name.mjs stacy-cli --expected-owner stacy-ai",
    "",
    "Environment:",
    "  STACY_NPM_EXPECTED_OWNER      Comma-separated npm usernames accepted as owners",
    "  STACY_CLI_NPM_EXPECTED_OWNER  Comma-separated npm usernames accepted as owners",
    "",
    "Exit codes:",
    "  0  package name is available, or owned by an expected owner",
    "  1  package name is taken, unknown, or npm could not be queried",
  ].join("\n"));
}

function parseArgs(args) {
  const options = {
    packageName: "stacy-cli",
    expectedOwners: new Set(
      [
        process.env.STACY_NPM_EXPECTED_OWNER,
        process.env.STACY_CLI_NPM_EXPECTED_OWNER,
      ]
        .filter(Boolean)
        .join(",")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
    json: false,
    allowTaken: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--expected-owner") {
      const owner = args[++index]?.trim();
      if (!owner) throw new Error("--expected-owner requires an npm username.");
      options.expectedOwners.add(owner);
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--allow-taken") {
      options.allowTaken = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (!arg.startsWith("-")) {
      options.packageName = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9][a-z0-9-._~]*$/.test(options.packageName)) {
    throw new Error(`Invalid npm package name: ${options.packageName}`);
  }

  return options;
}

function runNpm(args) {
  return spawnSync("npm", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
}

function isNotFound(result) {
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return result.status !== 0 && /\b(E404|404 Not Found|not found)\b/i.test(combined);
}

function parseViewPayload(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // npm may print plain output for some invocations; treat it as unknown.
  }
  return null;
}

function parseOwners(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/, 1)[0])
    .filter(Boolean);
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.status === "available") {
    console.log(`PASS: npm package '${result.packageName}' appears available.`);
    return;
  }

  if (result.status === "controlled") {
    console.log(
      `PASS: npm package '${result.packageName}' exists at ${result.version ?? "unknown version"} and is owned by an expected owner (${result.matchedOwners.join(", ")}).`,
    );
    return;
  }

  if (result.status === "taken") {
    console.error(
      `FAIL: npm package '${result.packageName}' exists at ${result.version ?? "unknown version"} and is not owned by an expected owner.`,
    );
    if (result.owners.length > 0) {
      console.error(`Owners: ${result.owners.join(", ")}`);
    }
    if (result.expectedOwners.length === 0) {
      console.error("Set STACY_NPM_EXPECTED_OWNER or pass --expected-owner during release prep if ownership is confirmed.");
    }
    return;
  }

  console.error(`FAIL: could not determine npm package status for '${result.packageName}'.`);
  if (result.error) console.error(result.error);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const view = runNpm(["view", options.packageName, "name", "version", "--json"]);

  if (isNotFound(view)) {
    const result = {
      packageName: options.packageName,
      status: "available",
      version: null,
      owners: [],
      expectedOwners: [...options.expectedOwners],
      matchedOwners: [],
    };
    printResult(result, options.json);
    process.exit(0);
  }

  if (view.status !== 0) {
    const result = {
      packageName: options.packageName,
      status: "unknown",
      version: null,
      owners: [],
      expectedOwners: [...options.expectedOwners],
      matchedOwners: [],
      error: (view.stderr || view.stdout || "npm view failed").trim(),
    };
    printResult(result, options.json);
    process.exit(options.allowTaken ? 0 : 1);
  }

  const viewPayload = parseViewPayload(view.stdout);
  const ownerResult = runNpm(["owner", "ls", options.packageName]);
  const owners = ownerResult.status === 0 ? parseOwners(ownerResult.stdout) : [];
  const matchedOwners = owners.filter((owner) => options.expectedOwners.has(owner));
  const status = matchedOwners.length > 0 ? "controlled" : "taken";
  const result = {
    packageName: options.packageName,
    status,
    version: typeof viewPayload?.version === "string" ? viewPayload.version : null,
    owners,
    expectedOwners: [...options.expectedOwners],
    matchedOwners,
  };

  printResult(result, options.json);
  process.exit(status === "controlled" || options.allowTaken ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
