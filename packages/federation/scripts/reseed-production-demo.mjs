#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FEDERATION_TABLES = [
  "federation_receipt_chain_head",
  "federation_receipt_anchors",
  "federation_receipts",
  "federation_received_nonces",
  "federation_revocation_sources",
  "federation_revocation_tombstones",
  "federation_consent_grants",
  "federation_knowledge_objects",
  "federation_group_rosters",
  "federation_key_transitions",
  "federation_witnessed_revocations",
];

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FEDERATION_ROOT = resolve(REPO_ROOT, "packages/federation");
const CLI_ENTRYPOINT = resolve(REPO_ROOT, "cli/src/index.ts");
const TSX_ENTRYPOINT = resolve(REPO_ROOT, "cli/node_modules/tsx/dist/cli.mjs");

const args = new Set(process.argv.slice(2));

if (args.has("--local-check")) {
  await run("node", ["scripts/phase5-public-demo.mjs"], { cwd: FEDERATION_ROOT });
  process.exit(0);
}

const configA = requiredEnv("STACY_FEDERATION_RESEED_A_CONFIG");
const configB = requiredEnv("STACY_FEDERATION_RESEED_B_CONFIG");
const endpointB = requiredEnv("STACY_FEDERATION_RESEED_B_ENDPOINT");
const revocationUrlA = requiredEnv("STACY_FEDERATION_RESEED_A_REVOCATION_URL");
const revocationUrlB = process.env.STACY_FEDERATION_RESEED_B_REVOCATION_URL?.trim() || endpointToRevocations(endpointB);
const contactName = process.env.STACY_FEDERATION_RESEED_CONTACT_NAME?.trim() || "meera";
const contactLabel = process.env.STACY_FEDERATION_RESEED_CONTACT_LABEL?.trim() || "Dr. Meera Patel / Eastside Specialty";
const koId = process.env.STACY_FEDERATION_RESEED_KO_ID?.trim() || "ko_referral_packet";
const demoCsv = process.env.STACY_FEDERATION_RESEED_INPUT?.trim() || resolve(FEDERATION_ROOT, "demo/referral-packet.csv");

console.log("[stacy-federation] wiping federation tables on install A");
await wipeFederationTables(configA);
console.log("[stacy-federation] wiping federation tables on install B");
await wipeFederationTables(configB);

console.log("[stacy-federation] seeding consumer identity");
await stacy(configB, [
  "brain",
  "create",
  "--content-json",
  JSON.stringify({ title: "Meera identity seed" }),
  "--ko-id",
  "ko_meera_identity_seed",
  "--json",
]);

console.log("[stacy-federation] creating signed contact share link");
const shareLink = JSON.parse(await stacy(configB, [
  "contacts",
  "share-link",
  contactName,
  "--endpoint",
  endpointB,
  "--revocation-url",
  revocationUrlB,
  "--label",
  contactLabel,
  "--expires",
  process.env.STACY_FEDERATION_RESEED_LINK_EXPIRES?.trim() || "15m",
  "--json",
]));

console.log("[stacy-federation] importing contact on producer install");
await stacy(configA, [
  "contacts",
  "import-link",
  shareLink.link,
  "--as",
  contactName,
  "--json",
]);

console.log("[stacy-federation] creating referral packet KO");
await stacy(configA, [
  "run",
  "Northstar Clinic Referral Packet",
  "--input",
  demoCsv,
  "--output-kind",
  "referral_packet",
  "--ko-id",
  koId,
  "--json",
]);

console.log("[stacy-federation] sharing referral packet to consumer install");
await stacy(configA, [
  "share",
  koId,
  "--with-contact",
  contactName,
  "--revocation-url",
  revocationUrlA,
  "--expires",
  process.env.STACY_FEDERATION_RESEED_GRANT_EXPIRES?.trim() || "30d",
  "--revocable",
  "--json",
]);

console.log(`[stacy-federation] production demo reseeded: ${koId}`);

async function wipeFederationTables(configPath) {
  const { default: postgres } = await import("postgres");
  const connectionString = await connectionStringFromConfig(configPath);
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    for (const table of FEDERATION_TABLES) {
      await sql.unsafe(`DO $$
BEGIN
  IF to_regclass('public.${table}') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE public.${table} CASCADE';
  END IF;
END $$;`);
    }
  } finally {
    await sql.end();
  }
}

async function connectionStringFromConfig(configPath) {
  const raw = JSON.parse(await readFile(configPath, "utf8"));
  const database = raw.database ?? {};
  if (database.mode === "postgres" && typeof database.connectionString === "string" && database.connectionString.trim()) {
    return database.connectionString.trim();
  }
  const port = database.embeddedPostgresPort;
  if (typeof port !== "number" || !Number.isInteger(port) || port <= 0) {
    throw new Error(`Cannot resolve database connection string from ${configPath}`);
  }
  return `postgres://stacy:stacy@127.0.0.1:${port}/stacy`;
}

async function stacy(configPath, commandArgs) {
  return await run("node", [
    TSX_ENTRYPOINT,
    CLI_ENTRYPOINT,
    ...commandArgs,
    "--config",
    configPath,
  ], {
    cwd: REPO_ROOT,
    env: {
      STACY_CONFIG: configPath,
    },
  });
}

function endpointToRevocations(endpoint) {
  const url = new URL(endpoint);
  url.pathname = url.pathname.replace(/\/api\/federation\/?$/, "/api/federation/revocations");
  return url.toString();
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Use --local-check for a local harness verification run.`);
  }
  return value;
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? REPO_ROOT,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      if (options.cwd === FEDERATION_ROOT) process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
      if (options.cwd === FEDERATION_ROOT) process.stderr.write(chunk);
    });
    child.on("error", rejectRun);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolveRun(stdout);
        return;
      }
      rejectRun(new Error(`${basename(command)} ${commandArgs.join(" ")} failed with exit code ${exitCode ?? "unknown"}\n${stderr}`));
    });
  });
}
