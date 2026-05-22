import { describe, expect, it } from "vitest";

import type { BrainDb } from "../brain/brain-store.js";
import { appendReceipt, listReceipts } from "./receipt-store.js";

describe("receipt store", () => {
  it("appends receipts without updating prior rows", async () => {
    const writes: unknown[] = [];
    const db: BrainDb = {
      execute: async (query) => {
        writes.push(query);
        return [];
      },
    };

    await expect(
      appendReceipt({
        db,
        eventType: "share",
        tenant: "stacy/acme",
        koId: "ko_receipt",
        actorInstallId: "install_a",
        counterpartyInstallId: "install_b",
        payload: { grantId: "grant_1" },
        createdAt: new Date("2026-05-22T00:00:00.000Z"),
        idGenerator: () => "receipt_1",
      }),
    ).resolves.toMatchObject({
      id: "receipt_1",
      eventType: "share",
      koId: "ko_receipt",
      actorInstallId: "install_a",
      counterpartyInstallId: "install_b",
    });

    expect(writes).toHaveLength(3);
  });

  it("lists receipts in stored order", async () => {
    const db = dbForRows([
      [
        {
          id: "receipt_1",
          event_type: "share",
          tenant: "stacy/acme",
          ko_id: "ko_receipt",
          actor_install_id: "install_a",
          counterparty_install_id: "install_b",
          payload_json: { grantId: "grant_1" },
          created_at: "2026-05-22T00:00:00.000Z",
        },
      ],
    ]);

    await expect(listReceipts({ db, koId: "ko_receipt" })).resolves.toEqual([
      {
        id: "receipt_1",
        eventType: "share",
        tenant: "stacy/acme",
        koId: "ko_receipt",
        actorInstallId: "install_a",
        counterpartyInstallId: "install_b",
        payload: { grantId: "grant_1" },
        createdAt: "2026-05-22T00:00:00.000Z",
      },
    ]);
  });
});

function dbForRows(rows: readonly unknown[]): BrainDb {
  let index = 0;
  return {
    execute: async () => rows[index++] ?? [],
  };
}
