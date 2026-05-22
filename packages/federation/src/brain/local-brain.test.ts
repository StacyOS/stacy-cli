import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SQL } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { readKnowledgeObject, type BrainDb } from "./brain-store.js";
import { createLocalKnowledgeObject } from "./local-brain.js";

class FakeBrainDb implements BrainDb {
  readonly queries: SQL[] = [];
  readonly rowsById = new Map<string, unknown>();

  async execute(query: SQL): Promise<unknown> {
    this.queries.push(query);
    return [];
  }
}

const tempRoots: string[] = [];

describe("local Brain KO creation", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  it("ensures identity, signs a KO, and stores it as local", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-local-brain-"));
    tempRoots.push(root);
    const db = new FakeBrainDb();

    const result = await createLocalKnowledgeObject({
      db,
      identityPath: join(root, "identity.json"),
      contentType: "application/json",
      content: { title: "Created by local Brain" },
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      storedAt: new Date("2026-05-22T00:00:01.000Z"),
      idGenerator: () => "ko_local_create",
    });

    expect(result.ko).toMatchObject({
      id: "ko_local_create",
      signedPayload: {
        tenant: "stacy/acme",
        creatorInstallId: result.creatorInstallId,
        content: { title: "Created by local Brain" },
      },
    });
    expect(result.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(db.queries.length).toBeGreaterThanOrEqual(13);
  });

  it("produces KOs that the Brain read path can verify", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-local-brain-"));
    tempRoots.push(root);
    const writerDb = new FakeBrainDb();

    const result = await createLocalKnowledgeObject({
      db: writerDb,
      identityPath: join(root, "identity.json"),
      contentType: "application/json",
      content: { title: "Readable" },
      idGenerator: () => "ko_readable",
    });
    const readerDb: BrainDb = {
      execute: async () => [
        {
          id: result.ko.id,
          signed_payload_json: result.ko.signedPayload,
          signer_json: result.ko.signer,
          signature: result.ko.signature,
          provenance_json: {
            source: "local",
            creatorInstallId: result.creatorInstallId,
            storedAt: "2026-05-22T00:00:01.000Z",
          },
        },
      ],
    };

    await expect(readKnowledgeObject({ db: readerDb, koId: result.ko.id })).resolves.toMatchObject({
      ok: true,
      verification: { contentHash: result.contentHash },
    });
  });
});
