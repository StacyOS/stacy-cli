import { spawnSync } from "node:child_process";

const cases = [
  {
    label: "tampered KO content is rejected",
    command: ["vitest", "run", "src/ko/knowledge-object.test.ts", "-t", "rejects tampered"],
  },
  {
    label: "forged revocation signature is rejected",
    command: ["vitest", "run", "src/consent/revocation.test.ts", "-t", "rejects forged signatures"],
  },
  {
    label: "replayed federation message nonce is rejected",
    command: ["vitest", "run", "src/sync/federation-message.test.ts", "-t", "rejects replayed federation message nonces"],
  },
  {
    label: "expired grant denies read",
    command: ["vitest", "run", "src/brain/read-with-consent.test.ts", "-t", "denies federated reads with an expired grant"],
  },
  {
    label: "revoked grant denies read",
    command: ["vitest", "run", "src/brain/read-with-consent.test.ts", "-t", "matching revocation tombstone"],
  },
  {
    label: "tampered contact share link is rejected",
    command: ["vitest", "run", "verbs/contacts.test.ts", "-t", "tampered nested card"],
  },
];

const startedAt = Date.now();
console.log("StacyOS federation adversarial demo");

for (const testCase of cases) {
  console.log(`\n== ${testCase.label} ==`);
  console.log(`$ ${testCase.command.join(" ")}`);
  const result = spawnSync(testCase.command[0], testCase.command.slice(1), {
    cwd: new URL("..", import.meta.url),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`\n[stacy-federation] adversarial case failed: ${testCase.label}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\n[stacy-federation] adversarial demo passed ${cases.length}/${cases.length} cases.`);
console.log(`[stacy-federation] runtime: ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
