import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createInstallIdentity } from "../identity/install-identity.js";
import { createKnowledgeObject } from "../ko/knowledge-object.js";
import {
  ensureBrainTables,
  readKnowledgeObject,
  storeKnowledgeObject,
  type BrainDb,
  type QueryResult,
} from "./brain-store.js";

class FakeBrainDb implements BrainDb {
  readonly queries: SQL[] = [];
  rows: readonly unknown[] = [];

  async execute<T = unknown>(query: SQL): Promise<QueryResult<T>> {
    this.queries.push(query);
    return this.rows as readonly T[];
  }
}

describe("Brain KO store", () => {
  it("ensures package-owned KO tables", async () => {
    const db = new FakeBrainDb();

    await ensureBrainTables(db);

    expect(db.queries).toHaveLength(3);
  });

  it("stores only valid signed Knowledge Objects", async () => {
    const db = new FakeBrainDb();
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { ok: true },
      identity,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      idGenerator: () => "ko_store",
    });

    const result = await storeKnowledgeObject({
      db,
      ko,
      source: "local",
      storedAt: new Date("2026-05-22T00:00:01.000Z"),
    });

    expect(result).toEqual({ id: "ko_store", contentHash: ko.signedPayload.contentHash });
    expect(db.queries).toHaveLength(4);
  });

  it("rejects invalid Knowledge Objects before writing", async () => {
    const db = new FakeBrainDb();
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { ok: true },
      identity,
    });

    await expect(
      storeKnowledgeObject({
        db,
        ko: {
          ...ko,
          signedPayload: { ...ko.signedPayload, tenant: "stacy/evil" },
        },
        source: "local",
      }),
    ).rejects.toThrow("Cannot store invalid Knowledge Object");
    expect(db.queries).toHaveLength(0);
  });

  it("reads and verifies stored local Knowledge Objects", async () => {
    const db = new FakeBrainDb();
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Hello" },
      identity,
      idGenerator: () => "ko_read",
    });
    db.rows = [
      {
        id: ko.id,
        signed_payload_json: ko.signedPayload,
        signer_json: ko.signer,
        signature: ko.signature,
        provenance_json: {
          source: "local",
          creatorInstallId: identity.record.installId,
          storedAt: "2026-05-22T00:00:01.000Z",
        },
      },
    ];

    const result = await readKnowledgeObject({ db, koId: ko.id });

    expect(result).toMatchObject({
      ok: true,
      ko,
      provenance: {
        source: "local",
        creatorInstallId: identity.record.installId,
      },
      verification: { contentHash: ko.signedPayload.contentHash },
    });
  });

  it("denies reads when stored bytes fail KO verification", async () => {
    const db = new FakeBrainDb();
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Hello" },
      identity,
      idGenerator: () => "ko_bad",
    });
    db.rows = [
      {
        id: ko.id,
        signed_payload_json: { ...ko.signedPayload, content: { title: "Tampered" } },
        signer_json: ko.signer,
        signature: ko.signature,
        provenance_json: {
          source: "local",
          creatorInstallId: identity.record.installId,
          storedAt: "2026-05-22T00:00:01.000Z",
        },
      },
    ];

    await expect(readKnowledgeObject({ db, koId: ko.id })).resolves.toMatchObject({
      ok: false,
    });
  });
});
