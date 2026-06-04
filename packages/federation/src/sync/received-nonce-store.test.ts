import { describe, expect, it } from "vitest";

import type { BrainDb } from "../brain/brain-store.js";
import { claimReceivedNonce } from "./received-nonce-store.js";

describe("received federation nonce store", () => {
  it("claims a new producer nonce with a durable insert", async () => {
    const db = dbForRows([[], [], [], [{ nonce: "nonce_once" }]]);

    await expect(
      claimReceivedNonce({
        db,
        producerInstallId: "install_producer",
        nonce: "nonce_once",
        receivedAt: new Date("2026-05-22T00:00:00.000Z"),
        expiresAt: new Date("2026-05-22T00:01:00.000Z"),
      }),
    ).resolves.toBe(true);
    expect(db.calls()).toBe(4);
  });

  it("rejects a nonce already claimed for the same producer", async () => {
    const db = dbForRows([[], [], [], []]);

    await expect(
      claimReceivedNonce({
        db,
        producerInstallId: "install_producer",
        nonce: "nonce_replayed",
        receivedAt: new Date("2026-05-22T00:00:00.000Z"),
        expiresAt: new Date("2026-05-22T00:01:00.000Z"),
      }),
    ).resolves.toBe(false);
  });
});

function dbForRows(rows: readonly unknown[]): BrainDb & { calls(): number } {
  let index = 0;
  return {
    execute: async () => rows[index++] ?? [],
    calls: () => index,
  };
}
