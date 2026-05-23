import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BrainDb } from "./brain-store.js";
import { createVerificationKnowledgeObject } from "./verification-brain.js";
import { parseCsvDashboardInput } from "../dashboard/dashboard-content.js";
import { createInstallIdentity } from "../identity/install-identity.js";
import { createKnowledgeObject, type SignedKnowledgeObject } from "../ko/knowledge-object.js";
import { VERIFICATION_REPORT_CONTENT_TYPE } from "../verification/verification-report.js";

const tempRoots: string[] = [];

describe("verification Brain KO creation", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  it("creates a signed verification report KO and records a source verify receipt", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-verification-brain-"));
    tempRoots.push(root);
    const producer = createInstallIdentity();
    const verifier = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const csvPath = join(root, "acme.csv");
    const csv = "revenue,pipeline\n100,500\n200,700\n";
    const input = parseCsvDashboardInput(csvPath, csv);
    const sourceKo = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: {
        kind: "dashboard",
        title: "LLM dashboard",
        task: "summarize revenue",
        input: {
          fileName: input.fileName,
          contentHash: input.contentHash,
          rows: input.rows,
        },
        widgets: [{ kind: "metric", label: "Revenue", value: "$300" }],
        summary: "Revenue increased.",
        generator: "adapter_command",
        generatedAt: "2026-05-22T00:00:00.000Z",
      },
      identity: producer,
      idGenerator: () => "ko_llm_dashboard",
    });
    const db = dbForRows([
      koRow(sourceKo, {
        source: "local",
        creatorInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
    ]);
    const identityPath = join(root, "identity.json");
    await writeIdentity(identityPath, verifier);

    const result = await createVerificationKnowledgeObject({
      db,
      identityPath,
      sourceKoId: sourceKo.id,
      input: { path: csvPath, raw: csv },
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      idGenerator: () => "ko_verification",
    });

    expect(result).toMatchObject({
      sourceKoId: "ko_llm_dashboard",
      sourceContentHash: sourceKo.signedPayload.contentHash,
      sourceProducerInstallId: producer.record.installId,
      ko: {
        id: "ko_verification",
        signedPayload: {
          contentType: VERIFICATION_REPORT_CONTENT_TYPE,
          creatorInstallId: verifier.record.installId,
          content: {
            kind: "verification_report",
            verdict: "pass",
            source: {
              koId: "ko_llm_dashboard",
              koContentHash: sourceKo.signedPayload.contentHash,
            },
          },
        },
      },
    });
    expect(result.report.checks.map((check) => [check.id, check.status])).toContainEqual([
      "source_input_reconciled",
      "pass",
    ]);
    expect(db.queries.length).toBeGreaterThan(8);
  });

  it("fails the verification report when source metadata does not match the supplied input", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-verification-brain-"));
    tempRoots.push(root);
    const producer = createInstallIdentity();
    const verifier = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const sourceKo = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: {
        kind: "dashboard",
        title: "LLM dashboard",
        task: "summarize revenue",
        input: {
          fileName: "wrong.csv",
          contentHash: "sha256:wrong",
          rows: 99,
        },
        widgets: [{ kind: "metric", label: "Revenue", value: "$300" }],
        summary: "Revenue increased.",
        generator: "adapter_command",
        generatedAt: "2026-05-22T00:00:00.000Z",
      },
      identity: producer,
      idGenerator: () => "ko_bad_dashboard",
    });
    const db = dbForRows([
      koRow(sourceKo, {
        source: "local",
        creatorInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
    ]);
    const identityPath = join(root, "identity.json");
    await writeIdentity(identityPath, verifier);

    const result = await createVerificationKnowledgeObject({
      db,
      identityPath,
      sourceKoId: sourceKo.id,
      input: { path: join(root, "acme.csv"), raw: "revenue\n100\n" },
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      idGenerator: () => "ko_bad_verification",
    });

    expect(result.report.verdict).toBe("fail");
    expect(result.report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "source_input_reconciled", status: "fail" }),
      ]),
    );
  });
});

function dbForRows(rows: readonly unknown[]): BrainDb & { readonly queries: unknown[] } {
  let index = 0;
  const queries: unknown[] = [];
  return {
    queries,
    execute: async (query) => {
      queries.push(query);
      return rows[index++] ?? [];
    },
  };
}

function koRow(ko: SignedKnowledgeObject, provenance: Record<string, unknown>) {
  return [
    {
      id: ko.id,
      signed_payload_json: ko.signedPayload,
      signer_json: ko.signer,
      signature: ko.signature,
      provenance_json: provenance,
    },
  ];
}

async function writeIdentity(path: string, identity: ReturnType<typeof createInstallIdentity>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(identity.record), { mode: 0o600 });
}
