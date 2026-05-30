import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createInstallIdentity } from "../src/identity/install-identity.js";
import { createKnowledgeObject } from "../src/ko/knowledge-object.js";
import { brainExportCommand } from "./brain-export.js";

describe("brainExportCommand", () => {
  it("writes a portable export envelope for a verified KO", async () => {
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Exportable" },
      identity,
      idGenerator: () => "ko_export",
    });
    const writes: { path: string; contents: string }[] = [];
    const lines: string[] = [];

    await brainExportCommand(
      ko.id,
      { dbUrl: "postgres://example", json: true },
      {
        createDb: () => ({ execute: async () => [] }),
        readKnowledgeObject: async () => ({
          ok: true,
          ko,
          provenance: {
            source: "local",
            creatorInstallId: identity.record.installId,
            storedAt: "2026-05-22T00:00:00.000Z",
          },
          verification: { contentHash: ko.signedPayload.contentHash },
        }),
        writeFile: async (path, contents) => {
          writes.push({ path, contents });
        },
        stdout: { log: (line) => lines.push(line) },
      },
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(resolve(`${ko.id}.stacy-ko.json`));
    const envelope = JSON.parse(writes[0]?.contents ?? "{}");
    expect(envelope).toMatchObject({
      kind: "stacy_knowledge_object_export",
      schemaVersion: 1,
      ko: { id: "ko_export" },
    });
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      koId: "ko_export",
      contentHash: ko.signedPayload.contentHash,
    });
  });

  it("honors a custom --out path", async () => {
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { ok: true },
      identity,
      idGenerator: () => "ko_export_out",
    });
    const writes: { path: string; contents: string }[] = [];

    await brainExportCommand(
      ko.id,
      { dbUrl: "postgres://example", out: "exports/ko.json" },
      {
        createDb: () => ({ execute: async () => [] }),
        readKnowledgeObject: async () => ({
          ok: true,
          ko,
          provenance: {
            source: "local",
            creatorInstallId: identity.record.installId,
            storedAt: "2026-05-22T00:00:00.000Z",
          },
          verification: { contentHash: ko.signedPayload.contentHash },
        }),
        writeFile: async (path, contents) => {
          writes.push({ path, contents });
        },
        stdout: { log: () => undefined },
      },
    );

    expect(writes[0]?.path).toBe(resolve("exports/ko.json"));
  });

  it("fails when the KO cannot be read or verified", async () => {
    const writes: string[] = [];

    await expect(
      brainExportCommand(
        "missing",
        { dbUrl: "postgres://example" },
        {
          createDb: () => ({ execute: async () => [] }),
          readKnowledgeObject: async () => ({ ok: false, reason: "Knowledge Object not found: missing" }),
          writeFile: async (path) => {
            writes.push(path);
          },
          stdout: { log: () => undefined },
        },
      ),
    ).rejects.toThrow("Knowledge Object not found: missing");

    expect(writes).toHaveLength(0);
  });
});
