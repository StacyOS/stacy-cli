import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");

const requiredPaths = [
  ["federation package", packageRoot],
  ["Stacy CLI entrypoint", resolve(repoRoot, "cli/src/index.ts")],
  ["tsx CLI runtime", resolve(repoRoot, "cli/node_modules/tsx/dist/cli.mjs")],
  ["server package", resolve(repoRoot, "server/package.json")],
  ["Phase 4 gate", resolve(packageRoot, "PHASE4_GATE.md")],
  ["acceptance harness", resolve(packageRoot, "test/acceptance/federation-demo.acceptance.test.ts")],
  ["real two-install smoke", resolve(packageRoot, "test/harness/real-two-install-smoke.test.ts")],
];

const missing = [];
for (const [label, path] of requiredPaths) {
  try {
    await access(path, constants.R_OK);
  } catch {
    missing.push({ label, path });
  }
}

if (missing.length > 0) {
  console.error("Stacy federation demo preflight failed. Missing required files:");
  for (const item of missing) {
    console.error(`- ${item.label}: ${item.path}`);
  }
  console.error("");
  console.error("Run `pnpm install` from the stacy-cli repo root, then retry `pnpm --filter @arpanstacy/stacy-federation demo:check`.");
  process.exit(1);
}

console.log("Stacy federation demo preflight passed.");
console.log(`repo: ${repoRoot}`);
console.log("demo check: pnpm --filter @arpanstacy/stacy-federation demo:check");
