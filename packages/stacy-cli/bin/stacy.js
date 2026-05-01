#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const localRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const localTsxBin = resolve(localRepoRoot, "cli/node_modules/tsx/dist/cli.mjs");
const localCliSource = resolve(localRepoRoot, "cli/src/index.ts");

let command = process.execPath;
let args;
try {
  args = [require.resolve("paperclipai/dist/index.js"), ...process.argv.slice(2)];
} catch {
  if (existsSync(localTsxBin) && existsSync(localCliSource)) {
    args = [localTsxBin, localCliSource, ...process.argv.slice(2)];
  } else {
    console.error("Unable to locate the bundled Stacy CLI dependency. Try reinstalling stacy-cli.");
    process.exit(1);
  }
}

const child = spawn(command, args, {
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Failed to start Stacy CLI: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
