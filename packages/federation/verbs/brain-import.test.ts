import { describe, expect, it } from "vitest";

import { createInstallIdentity } from "../src/identity/install-identity.js";
import { createKnowledgeObject } from "../src/ko/knowledge-object.js";
import { brainImportCommand } from "./brain-import.js";

function exportEnvelope(ko: unknown): string {
  return `${JSON.stringify({ kind: "stacy_knowledge_object_export", schemaVersion: 1, ko }, null, 2)}\n`;
}

describe("brainImportCommand", () => {
  it("verifies and stores an imported KO as federated by default", async () => {
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Imported" },
      identity,
      idGenerator: () => "ko_import",
    });
    const stored: { id: string; source: string }[] = [];
    const lines: string[] = [];

    await brainImportCommand(
      "incoming/ko.json",
      { dbUrl: "postgres://example", json: true },
      {
        createDb: () => ({ execute: async () => [] }),
        readFile: async () => exportEnvelope(ko),
        storeKnowledgeObject: async ({ ko: incoming, source }) => {
          stored.push({ id: incoming.id, source });
          return { id: incoming.id, contentHash: incoming.signedPayload.contentHash };
        },
        stdout: { log: (line) => lines.push(line) },
      },
    );

    expect(stored).toEqual([{ id: "ko_import", source: "federated" }]);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      koId: "ko_import",
      source: "federated",
    });
  });

  it("supports importing as a local KO", async () => {
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { ok: true },
      identity,
      idGenerator: () => "ko_import_local",
    });
    const stored: string[] = [];

    await brainImportCommand(
      "incoming/ko.json",
      { dbUrl: "postgres://example", source: "local" },
      {
        createDb: () => ({ execute: async () => [] }),
        readFile: async () => exportEnvelope(ko),
        storeKnowledgeObject: async ({ source }) => {
          stored.push(source);
          return { id: ko.id, contentHash: ko.signedPayload.contentHash };
        },
        stdout: { log: () => undefined },
      },
    );

    expect(stored).toEqual(["local"]);
  });

  it("rejects a tampered KO before storing", async () => {
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Original" },
      identity,
      idGenerator: () => "ko_tampered",
    });
    const tampered = {
      ...ko,
      signedPayload: { ...ko.signedPayload, content: { title: "Tampered" } },
    };
    let stored = false;

    await expect(
      brainImportCommand(
        "incoming/ko.json",
        { dbUrl: "postgres://example" },
        {
          createDb: () => ({ execute: async () => [] }),
          readFile: async () => exportEnvelope(tampered),
          storeKnowledgeObject: async () => {
            stored = true;
            return { id: ko.id, contentHash: ko.signedPayload.contentHash };
          },
          stdout: { log: () => undefined },
        },
      ),
    ).rejects.toThrow("Cannot import invalid Knowledge Object");

    expect(stored).toBe(false);
  });

  it("rejects a file that is not an export envelope", async () => {
    await expect(
      brainImportCommand(
        "incoming/ko.json",
        { dbUrl: "postgres://example" },
        {
          createDb: () => ({ execute: async () => [] }),
          readFile: async () => JSON.stringify({ kind: "something_else" }),
          stdout: { log: () => undefined },
        },
      ),
    ).rejects.toThrow("wrong kind");
  });
});
