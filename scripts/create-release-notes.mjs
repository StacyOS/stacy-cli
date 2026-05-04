#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const releasesDir = resolve(repoRoot, "releases");

function usage() {
  console.log([
    "Usage:",
    "  node scripts/create-release-notes.mjs [--version YYYY.MDD.P] [--date YYYY-MM-DD] [--force] [--dry-run]",
    "",
    "Examples:",
    "  pnpm release:notes",
    "  pnpm release:notes -- --date 2026-04-30",
    "  pnpm release:notes -- --version 2026.430.0",
    "",
    "Notes:",
    "  - When --version is omitted, the script picks the next local release-notes slot for --date or today.",
    "  - The release script remains authoritative for the final publish version because it checks npm.",
  ].join("\n"));
}

function parseArgs(args) {
  const options = {
    version: "",
    date: "",
    force: false,
    dryRun: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--version") {
      options.version = args[++index] ?? "";
      continue;
    }
    if (arg === "--date") {
      options.date = args[++index] ?? "";
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (!options.version && !arg.startsWith("-")) {
      options.version = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  return options;
}

function parseReleaseDate(raw) {
  const value = raw || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid --date value '${value}'. Expected YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid --date value '${value}'.`);
  }
  if (date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid --date value '${value}'.`);
  }
  return { value, date };
}

function stableSlotForDate(date) {
  const month = String(date.getUTCMonth() + 1);
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}.${month}${day}`;
}

function nextLocalVersionForDate(date) {
  const slot = stableSlotForDate(date);
  const pattern = new RegExp(`^v${slot.replace(/\./g, "\\.")}\\.(\\d+)\\.md$`);
  let maxPatch = -1;

  if (existsSync(releasesDir)) {
    for (const name of readdirSync(releasesDir)) {
      const match = name.match(pattern);
      if (!match) continue;
      maxPatch = Math.max(maxPatch, Number(match[1]));
    }
  }

  return `${slot}.${maxPatch + 1}`;
}

function validateStableVersion(version) {
  if (!/^\d{4}\.\d{3,4}\.\d+$/.test(version)) {
    throw new Error(`Invalid stable version '${version}'. Expected a calendar version like 2026.430.0.`);
  }
}

function renderTemplate(version, releaseDate) {
  return [
    `# v${version}`,
    "",
    `> Release date: ${releaseDate}`,
    "> Status: Draft",
    "",
    "## Summary",
    "",
    "- ",
    "",
    "## Operator Notes",
    "",
    "- Run the upgrade preflight before changing the instance:",
    "",
    "```bash",
    "pnpm stacy upgrade:check --strict",
    "```",
    "",
    "- Create a fresh database backup before deploying:",
    "",
    "```bash",
    "pnpm stacy db:backup",
    "```",
    "",
    "- For Docker/self-hosted instances, stop the app before applying a restore:",
    "",
    "```bash",
    "docker compose -f docker/docker-compose.quickstart.yml down",
    "pnpm stacy db:restore --latest --dry-run",
    "pnpm stacy db:restore --latest --yes",
    "docker compose -f docker/docker-compose.quickstart.yml up -d",
    "```",
    "",
    "## Changes",
    "",
    "### Added",
    "",
    "- ",
    "",
    "### Changed",
    "",
    "- ",
    "",
    "### Fixed",
    "",
    "- ",
    "",
    "## Breaking Changes",
    "",
    "- None known.",
    "",
    "## Verification",
    "",
    "- [ ] `pnpm --filter @arpanstacy/stacy typecheck`",
    "- [ ] `pnpm test:run`",
    "- [ ] `pnpm build`",
    "- [ ] `pnpm release:phase5-gate`",
    "- [ ] `pnpm smoke:codex-local-preflight`",
    "- [ ] `pnpm smoke:claude-local-preflight`",
    "- [ ] `pnpm smoke:docker-quickstart`",
    "",
    "## Rollback",
    "",
    "- Restore the previous image/package version.",
    "- Restore the latest known-good database backup if migrations or data changes need reversal.",
    "- Re-run `pnpm stacy upgrade:check` after rollback.",
    "",
    "## Known Limitations",
    "",
    "- ",
    "",
  ].join("\n");
}

try {
  const options = parseArgs(process.argv.slice(2));
  const parsedDate = parseReleaseDate(options.date);
  const version = options.version || nextLocalVersionForDate(parsedDate.date);
  validateStableVersion(version);

  const outputPath = resolve(releasesDir, `v${version}.md`);
  const output = renderTemplate(version, parsedDate.value);

  if (existsSync(outputPath) && !options.force) {
    throw new Error(`Release notes already exist: ${outputPath}. Re-run with --force to overwrite.`);
  }

  if (options.dryRun) {
    console.log(outputPath);
    console.log(output);
  } else {
    mkdirSync(releasesDir, { recursive: true });
    writeFileSync(outputPath, output);
    console.log(`Created ${outputPath}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
