import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repeatCount = Number.parseInt(process.env.STACY_FEDERATION_DEMO_REPEAT ?? "2", 10);

if (!Number.isInteger(repeatCount) || repeatCount < 1) {
  console.error("STACY_FEDERATION_DEMO_REPEAT must be a positive integer.");
  process.exit(1);
}

const timings = [];
for (let index = 1; index <= repeatCount; index += 1) {
  const startedAt = performance.now();
  console.log(`\n[stacy-federation] demo:check run ${index}/${repeatCount}`);
  await runDemoCheck();
  const durationMs = Math.round(performance.now() - startedAt);
  timings.push(durationMs);
  console.log(`[stacy-federation] run ${index}/${repeatCount} passed in ${formatDuration(durationMs)}`);
}

const slowestMs = Math.max(...timings);
console.log("");
console.log(`[stacy-federation] repeated demo check passed ${repeatCount}/${repeatCount} runs.`);
console.log(`[stacy-federation] slowest run: ${formatDuration(slowestMs)}`);

function runDemoCheck() {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("pnpm", ["run", "demo:check"], {
      cwd: packageRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", rejectRun);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`demo:check failed with exit code ${exitCode ?? "unknown"}`));
    });
  });
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}
