import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(scriptDir, "../test/fixtures/adapter-runs/referral-packet-claude.json");

process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(readFileSync(fixturePath, "utf8").trim());
});
