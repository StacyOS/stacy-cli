import { spawn } from "node:child_process";

await run("vitest", ["run", "test/harness/public-demo-smoke.test.ts", "--reporter", "verbose"], {
  STACY_FEDERATION_PUBLIC_DEMO_SMOKE: "1",
});

function run(command, args, env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("error", rejectRun);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`${command} ${args.join(" ")} failed with exit code ${exitCode ?? "unknown"}`));
    });
  });
}
