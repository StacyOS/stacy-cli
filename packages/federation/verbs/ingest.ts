import { createInterface } from "node:readline/promises";

import { createDb } from "@arpanstacy/stacy-db";

import type { BrainDb } from "../src/brain/brain-store.js";
import type { Connector, NormalizedObject } from "../src/connectors/types.js";
import type { KeychainStore } from "../src/connectors/keychain.js";
import { storeIngestedObject } from "../src/connectors/ingest-service.js";
import {
  buildGitHubConnector,
  defaultGitHubRateLimiter,
  resolveConnectorKeychain,
  resolveSince,
} from "./connector-runtime.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface IngestGithubOptions extends LocalRuntimeOptions {
  readonly repo?: string;
  readonly pulls?: boolean;
  readonly issues?: boolean;
  readonly state?: string;
  readonly label?: string;
  readonly since?: string;
  readonly yes?: boolean;
  readonly json?: boolean;
}

export interface IngestDependencies extends LocalRuntimeDependencies {
  readonly createDb?: (connectionString: string) => BrainDb;
  readonly keychain?: KeychainStore;
  readonly connector?: Connector;
  readonly confirm?: (summary: string) => Promise<boolean>;
  readonly now?: Date;
  readonly stdout?: Pick<typeof console, "log">;
}

export async function ingestGithubCommand(
  options: IngestGithubOptions,
  dependencies: IngestDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);

  const repo = options.repo?.trim();
  if (!repo) throw new Error("`stacy ingest github` requires --repo <owner/name>.");

  const wantIssues = options.issues === true;
  const wantPulls = options.pulls === true || !wantIssues;
  const state = normalizeState(options.state);
  const since = resolveSince(options.since, dependencies.now ?? new Date());

  const keychain = dependencies.keychain ?? resolveConnectorKeychain(runtime);
  const connector = dependencies.connector ?? buildGitHubConnector({ rateLimiter: defaultGitHubRateLimiter(runtime.instanceRoot) });
  const token = await keychain.get(connector.id);
  if (!token) {
    throw new Error(`${connector.id} is not connected. Run \`stacy connect ${connector.id}\` first.`);
  }

  // Fetch + normalize first so the confirmation can show a real count.
  const objects: NormalizedObject[] = [];
  for await (const object of connector.ingest({
    token,
    params: {
      repo,
      pulls: wantPulls,
      issues: wantIssues,
      state,
      label: options.label,
      since,
      ingestCommand: buildIngestCommand(options),
    },
  })) {
    objects.push(object);
  }

  const summary = [
    "Stacy will ingest:",
    `  Connector:    ${connector.id}`,
    `  Repo:         ${repo}`,
    `  Object kinds: ${[wantPulls ? "github_pull_request" : null, wantIssues ? "github_issue" : null].filter(Boolean).join(", ")}`,
    `  Filter:       state=${state}${options.label ? `, label=${options.label}` : ""}${since ? `, since=${since}` : ""}`,
    `  Estimated:    ${objects.length} object(s)`,
    "  Storage:      local only",
    "  Sharing:      off by default",
  ].join("\n");

  const approved = options.yes === true || (await confirmIngest(summary, dependencies, stdout));
  if (!approved) {
    stdout.log("Ingestion cancelled.");
    return;
  }

  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);

  try {
    const stored = [];
    for (const object of objects) {
      const result = await storeIngestedObject({
        db,
        identityPath: runtime.identityPath,
        object,
        createdAt: dependencies.now,
        storedAt: dependencies.now,
      });
      stored.push({ koId: result.ko.id, kind: result.kind, sourceId: result.sourceId, contentHash: result.contentHash });
    }

    if (options.json) {
      stdout.log(JSON.stringify({ ingested: stored }, null, 2));
      return;
    }
    if (stored.length === 0) {
      stdout.log("No matching objects to ingest.");
      return;
    }
    stdout.log(
      [
        `Ingested ${stored.length} Knowledge Object(s) from ${repo}.`,
        ...stored.map((row) => `  ${row.koId}  ${row.kind}  ${row.sourceId}`),
        "",
        "Verify any of them with `stacy brain verify <ko_id>`.",
      ].join("\n"),
    );
  } finally {
    if (ownsDb) await closeDb(db);
  }
}

function normalizeState(value: string | undefined): "open" | "closed" | "all" {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return "open";
  if (trimmed === "open" || trimmed === "closed" || trimmed === "all") return trimmed;
  throw new Error(`Invalid --state "${value}". Expected open, closed, or all.`);
}

function buildIngestCommand(options: IngestGithubOptions): string {
  const parts = ["stacy ingest github", `--repo ${options.repo ?? ""}`];
  if (options.pulls) parts.push("--pulls");
  if (options.issues) parts.push("--issues");
  if (options.state) parts.push(`--state ${options.state}`);
  if (options.label) parts.push(`--label ${options.label}`);
  if (options.since) parts.push(`--since ${options.since}`);
  return parts.join(" ");
}

async function confirmIngest(
  summary: string,
  dependencies: IngestDependencies,
  stdout: Pick<typeof console, "log">,
): Promise<boolean> {
  if (dependencies.confirm) return dependencies.confirm(summary);

  stdout.log(summary);
  if (!process.stdin.isTTY) {
    throw new Error("Ingestion needs confirmation. Re-run with --yes for non-interactive use.");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Continue? [y/N] ");
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

async function closeDb(db: BrainDb): Promise<void> {
  const maybeDb = db as { readonly $client?: { end?: () => Promise<unknown> } };
  await maybeDb.$client?.end?.();
}
