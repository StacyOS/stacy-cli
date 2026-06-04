import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface RateLimiterOptions {
  /** Maximum grants permitted within any window of length `windowMs`. */
  readonly limit: number;
  readonly windowMs: number;
  /** Injectable clock (ms since epoch) for deterministic tests. */
  readonly now?: () => number;
  /** Injectable sleep so tests advance time without real delays. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Optional path to persist limiter state across process restarts. */
  readonly statePath?: string;
}

interface PersistedState {
  readonly grants: readonly number[];
  readonly resetAt?: number;
}

/**
 * Sliding-window rate limiter. Guarantees at most `limit` grants in any window
 * of length `windowMs`. Also honors a hard reset deadline learned from an HTTP
 * `X-RateLimit-Reset` header (see {@link noteRateLimitReset}). State can be
 * persisted so a restart does not re-hammer the upstream API.
 */
export class SlidingWindowRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly statePath?: string;
  private grants: number[] = [];
  private resetAt?: number;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions) {
    if (options.limit < 1) throw new Error("Rate limiter limit must be >= 1.");
    if (options.windowMs < 1) throw new Error("Rate limiter windowMs must be >= 1.");
    this.limit = Math.trunc(options.limit);
    this.windowMs = Math.trunc(options.windowMs);
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
    this.statePath = options.statePath;
  }

  /** Load any persisted state. Safe to call once before first acquire. */
  async load(): Promise<void> {
    if (!this.statePath) return;
    try {
      const state = JSON.parse(await readFile(this.statePath, "utf8")) as PersistedState;
      this.grants = [...state.grants];
      this.resetAt = state.resetAt;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }

  /**
   * Record an upstream rate-limit reset deadline (epoch ms). Until that moment
   * the limiter blocks all grants, modeling a 429 with `Retry-After`/reset.
   */
  noteRateLimitReset(resetAtEpochMs: number): void {
    this.resetAt = Math.max(this.resetAt ?? 0, resetAtEpochMs);
  }

  /** Resolves when a grant is permitted, recording the grant time. */
  async acquire(): Promise<void> {
    // Serialize acquisitions so concurrent callers cannot race past the limit.
    const run = this.chain.then(() => this.acquireOne());
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async acquireOne(): Promise<void> {
    for (;;) {
      const now = this.now();

      if (this.resetAt !== undefined && now < this.resetAt) {
        await this.sleep(this.resetAt - now);
        continue;
      }

      this.grants = this.grants.filter((t) => t > now - this.windowMs);
      if (this.grants.length < this.limit) {
        this.grants.push(now);
        await this.persist();
        return;
      }

      const oldest = this.grants[0] ?? now;
      const waitMs = Math.max(1, oldest + this.windowMs - now);
      await this.sleep(waitMs);
    }
  }

  private async persist(): Promise<void> {
    if (!this.statePath) return;
    const state: PersistedState = { grants: this.grants, resetAt: this.resetAt };
    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
