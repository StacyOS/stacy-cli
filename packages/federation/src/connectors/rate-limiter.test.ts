import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SlidingWindowRateLimiter } from "./rate-limiter.js";

const tempRoots: string[] = [];

/** A virtual clock whose `sleep` simply advances time, for deterministic tests. */
function virtualClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    get time() {
      return t;
    },
  };
}

describe("SlidingWindowRateLimiter", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  it("never exceeds the limit within any window of the configured length", async () => {
    const clock = virtualClock();
    const limit = 5;
    const windowMs = 1000;
    const limiter = new SlidingWindowRateLimiter({ limit, windowMs, now: clock.now, sleep: clock.sleep });

    const grantTimes: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      await limiter.acquire();
      grantTimes.push(clock.now());
    }

    // For every grant, at most `limit` grants fall in the window starting there.
    for (const start of grantTimes) {
      const inWindow = grantTimes.filter((t) => t >= start && t < start + windowMs);
      expect(inWindow.length).toBeLessThanOrEqual(limit);
    }
    expect(grantTimes).toHaveLength(50);
  });

  it("permits an initial burst up to the limit without waiting", async () => {
    const clock = virtualClock(10_000);
    const limiter = new SlidingWindowRateLimiter({ limit: 3, windowMs: 1000, now: clock.now, sleep: clock.sleep });

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(clock.time).toBe(10_000); // no time advanced for the first `limit` grants
  });

  it("blocks until an upstream rate-limit reset deadline", async () => {
    const clock = virtualClock(1000);
    const limiter = new SlidingWindowRateLimiter({ limit: 10, windowMs: 1000, now: clock.now, sleep: clock.sleep });

    limiter.noteRateLimitReset(5000);
    await limiter.acquire();

    expect(clock.time).toBe(5000);
  });

  it("persists and restores limiter state across restarts", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-ratelimit-"));
    tempRoots.push(root);
    const statePath = join(root, "state.json");
    const clock = virtualClock(0);

    const first = new SlidingWindowRateLimiter({ limit: 2, windowMs: 1000, now: clock.now, sleep: clock.sleep, statePath });
    await first.acquire();
    await first.acquire();

    const second = new SlidingWindowRateLimiter({ limit: 2, windowMs: 1000, now: clock.now, sleep: clock.sleep, statePath });
    await second.load();
    // Both slots already used at t=0; the next grant must wait out the window.
    await second.acquire();
    expect(clock.time).toBeGreaterThanOrEqual(1000);
  });
});
