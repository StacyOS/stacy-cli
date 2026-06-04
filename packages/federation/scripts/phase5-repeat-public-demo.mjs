import { spawn } from "node:child_process";

const repeatCount = Number.parseInt(process.env.STACY_FEDERATION_PUBLIC_DEMO_REPEAT ?? "2", 10);
if (!Number.isInteger(repeatCount) || repeatCount < 1) {
  console.error("STACY_FEDERATION_PUBLIC_DEMO_REPEAT must be a positive integer.");
  process.exit(1);
}

const timings = [];
for (let index = 1; index <= repeatCount; index += 1) {
  const startedAt = performance.now();
  console.log(`\n[stacy-federation] public demo run ${index}/${repeatCount}`);
  await runPublicDemo();
  const durationMs = Math.round(performance.now() - startedAt);
  if (durationMs >= 4 * 60 * 1000) {
    throw new Error(`public demo run ${index} exceeded four minutes: ${(durationMs / 1000).toFixed(2)}s`);
  }
  timings.push(durationMs);
  console.log(`[stacy-federation] public demo run ${index}/${repeatCount} passed in ${(durationMs / 1000).toFixed(2)}s`);
}

console.log("");
console.log(`[stacy-federation] repeated public demo passed ${repeatCount}/${repeatCount} runs.`);
console.log(`[stacy-federation] slowest public demo run: ${(Math.max(...timings) / 1000).toFixed(2)}s`);

function runPublicDemo() {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("pnpm", ["run", "demo:public"], {
      cwd: new URL("..", import.meta.url),
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", rejectRun);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`demo:public failed with exit code ${exitCode ?? "unknown"}`));
    });
  });
}
