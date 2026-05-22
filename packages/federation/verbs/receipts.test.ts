import { describe, expect, it } from "vitest";

import { receiptsListCommand } from "./receipts.js";

describe("receiptsListCommand", () => {
  it("prints raw receipt JSON", async () => {
    const lines: string[] = [];

    await receiptsListCommand(
      { dbUrl: "postgres://example", ko: "ko_public", json: true },
      {
        createDb: () => dbForRows([
          [
            receiptRow("receipt_read", "read", "install_b", "install_a"),
            receiptRow("receipt_deny", "deny", "install_b", "install_a"),
          ],
        ]),
        stdout: { log: (line) => lines.push(line) },
      },
    );

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      receipts: [
        { id: "receipt_read", eventType: "read", koId: "ko_public" },
        { id: "receipt_deny", eventType: "deny", koId: "ko_public" },
      ],
    });
  });

  it("prints grouped receipt text for presenters", async () => {
    const lines: string[] = [];

    await receiptsListCommand(
      { dbUrl: "postgres://example", ko: "ko_public" },
      {
        createDb: () => dbForRows([
          [
            receiptRow("receipt_create", "create", "install_a"),
            receiptRow("receipt_share", "share", "install_a", "install_b"),
            receiptRow("receipt_revoke", "revoke", "install_a"),
          ],
        ]),
        stdout: { log: (line) => lines.push(line) },
      },
    );

    const output = lines.join("\n");
    expect(output).toContain("Federation receipts:");
    expect(output).toContain("By event:");
    expect(output).toContain("create: 1");
    expect(output).toContain("share: 1");
    expect(output).toContain("revoke: 1");
    expect(output).toContain("Events:");
    expect(output).toContain("share (ko_public) by install_a -> install_b");
    expect(output).toContain("Total: 3");
  });
});

function receiptRow(
  id: string,
  eventType: string,
  actorInstallId: string,
  counterpartyInstallId?: string,
) {
  return {
    id,
    event_type: eventType,
    tenant: "stacy/acme",
    ko_id: "ko_public",
    actor_install_id: actorInstallId,
    counterparty_install_id: counterpartyInstallId ?? null,
    payload_json: {},
    created_at: "2026-05-22T00:00:00.000Z",
  };
}

function dbForRows(rows: readonly unknown[]) {
  let index = 0;
  return {
    execute: async () => rows[index++] ?? [],
  };
}
