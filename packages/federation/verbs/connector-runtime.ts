import { FileKeychain, type KeychainStore } from "../src/connectors/keychain.js";
import { ConnectorRegistry } from "../src/connectors/registry.js";
import { SlidingWindowRateLimiter } from "../src/connectors/rate-limiter.js";
import { GitHubConnector } from "../src/connectors/github/connector.js";
import {
  resolveConnectorStateDir,
  resolveConnectorTokenStorePath,
} from "../src/identity/paths.js";
import type { LocalRuntime } from "./local-runtime.js";

/** GitHub allows 5000 req/hour for authenticated calls; stay well under it. */
export function defaultGitHubRateLimiter(instanceRoot: string): SlidingWindowRateLimiter {
  return new SlidingWindowRateLimiter({
    limit: 1000,
    windowMs: 60 * 60 * 1000,
    statePath: `${resolveConnectorStateDir(instanceRoot)}/github-ratelimit.json`,
  });
}

export function resolveConnectorKeychain(runtime: LocalRuntime): KeychainStore {
  return new FileKeychain({ storePath: resolveConnectorTokenStorePath(runtime.instanceRoot) });
}

export interface BuildGitHubConnectorOptions {
  readonly clientId?: string;
  readonly rateLimiter?: SlidingWindowRateLimiter;
}

export function buildGitHubConnector(options: BuildGitHubConnectorOptions = {}): GitHubConnector {
  return new GitHubConnector({
    clientId: options.clientId ?? "",
    rateLimiter: options.rateLimiter,
  });
}

/** Registry of descriptors for `stacy connectors list`. */
export function buildConnectorRegistry(): ConnectorRegistry {
  const registry = new ConnectorRegistry();
  registry.register(buildGitHubConnector());
  return registry;
}

/**
 * Resolve a relative time window like `7d`, `24h`, `90m` into an ISO timestamp,
 * or pass through an explicit ISO date. Returns undefined for empty input.
 */
export function resolveSince(value: string | undefined, now: Date = new Date()): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const match = /^(\d+)\s*([dhm])$/i.exec(trimmed);
  if (match) {
    const amount = Number.parseInt(match[1] as string, 10);
    const unitMs = { d: 86_400_000, h: 3_600_000, m: 60_000 }[match[2]?.toLowerCase() as "d" | "h" | "m"];
    return new Date(now.getTime() - amount * unitMs).toISOString();
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --since "${value}". Expected a duration (7d, 24h, 90m) or ISO date.`);
  }
  return parsed.toISOString();
}
