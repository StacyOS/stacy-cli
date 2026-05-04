#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const testRoot = mkdtempSync(path.join(os.tmpdir(), `stacy-worker-owned-smoke-${process.pid}-`));
const env = {
  ...process.env,
  STACY_HOME: path.join(testRoot, "home"),
  STACY_INSTANCE_ID: `worker-owned-smoke-${process.pid}`,
  STACY_HEARTBEAT_DISPATCH_MODE: "worker_owned",
  STACY_HEARTBEAT_DISPATCH_WORKER_ENABLED: "true",
  STACY_HEARTBEAT_DISPATCH_WORKER_INTERVAL_MS: "1000",
  STACY_HEARTBEAT_DISPATCH_WORKER_BATCH_SIZE: "10",
  STACY_HEARTBEAT_DISPATCH_WORKER_LEASE_MS: "60000",
  TMPDIR: path.join(testRoot, "tmp"),
};

mkdirSync(env.STACY_HOME, { recursive: true });
mkdirSync(env.TMPDIR, { recursive: true });

const tests = [
  "server/src/__tests__/heartbeat-worker-owned-phase2-smoke.test.ts",
  "server/src/__tests__/heartbeat-dispatch-mode.test.ts",
];

console.log("[smoke:heartbeat-worker-owned] profile");
console.log(`  STACY_HEARTBEAT_DISPATCH_MODE=${env.STACY_HEARTBEAT_DISPATCH_MODE}`);
console.log(`  STACY_HOME=${env.STACY_HOME}`);
console.log(`  tests=${tests.join(" ")}`);

const result = spawnSync("pnpm", ["exec", "vitest", "run", ...tests], {
  cwd: repoRoot,
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`[smoke:heartbeat-worker-owned] Failed to start Vitest: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
