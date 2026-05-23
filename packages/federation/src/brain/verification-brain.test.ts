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

  it("verifies v1 and v2 referral packet contracts and fails unknown versions", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-verification-brain-"));
    tempRoots.push(root);
    const producer = createInstallIdentity();
    const verifier = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const identityPath = join(root, "identity.json");
    await writeIdentity(identityPath, verifier);

    const v1 = createKnowledgeObject({
      tenant: "stacy/clinic",
      contentType: "application/json",
      content: referralPacketContent(1),
      identity: producer,
      idGenerator: () => "ko_referral_v1",
    });
    const v2 = createKnowledgeObject({
      tenant: "stacy/clinic",
      contentType: "application/json",
      content: referralPacketContent(2, { carePriority: "urgent" }),
      identity: producer,
      idGenerator: () => "ko_referral_v2",
    });
    const unknown = createKnowledgeObject({
      tenant: "stacy/clinic",
      contentType: "application/json",
      content: referralPacketContent(99),
      identity: producer,
      idGenerator: () => "ko_referral_v99",
    });

    const v1Result = await createVerificationKnowledgeObject({
      db: dbForRows([koRow(v1, provenance(producer))]),
      identityPath,
      sourceKoId: v1.id,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
    });
    const v2Result = await createVerificationKnowledgeObject({
      db: dbForRows([koRow(v2, provenance(producer))]),
      identityPath,
      sourceKoId: v2.id,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
    });
    const unknownResult = await createVerificationKnowledgeObject({
      db: dbForRows([koRow(unknown, provenance(producer))]),
      identityPath,
      sourceKoId: unknown.id,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
    });

    expect(v1Result.report.verdict).toBe("pass");
    expect(v1Result.report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "content_contract_version", status: "pass" }),
      expect.objectContaining({ id: "referral_packet_contract", status: "pass" }),
    ]));
    expect(v2Result.report.verdict).toBe("pass");
    expect(v2Result.report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "content_contract_version",
        status: "pass",
        details: expect.objectContaining({ schemaVersion: 2 }),
      }),
    ]));
    expect(unknownResult.report.verdict).toBe("fail");
    expect(unknownResult.report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "content_contract_version",
        status: "fail",
        summary: "Unsupported referral_packet schema version 99.",
      }),
    ]));
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

function provenance(producer: ReturnType<typeof createInstallIdentity>) {
  return {
    source: "local",
    creatorInstallId: producer.record.installId,
    storedAt: "2026-05-22T00:00:00.000Z",
  };
}

function referralPacketContent(schemaVersion: number, extra: Record<string, unknown> = {}) {
  return {
    kind: "referral_packet",
    schemaVersion,
    title: "Northstar Clinic Referral Packet",
    task: "Northstar Clinic Referral Packet",
    input: {
      fileName: "referral-packet.csv",
      contentHash: "sha256:csv",
      rows: 1,
    },
    patientReference: "N.P.",
    referralReason: "Second opinion after abnormal ECG",
    clinicalSummary: "Intermittent chest tightness.",
    labSnapshot: "LDL 162 mg/dL; troponin negative",
    medications: ["Atorvastatin 20mg", "aspirin 81mg"],
    imagingStatus: "ECG attached",
    consent: {
      expiresAt: "2026-06-22T23:59:59Z",
      revocationReason: "Patient withdrew consent",
    },
    attachments: [{ label: "ECG", status: "attached" }],
    summary: "Northstar Clinic Referral Packet: second opinion.",
    generator: "deterministic_referral_packet",
    generatedAt: "1970-01-01T00:00:00.000Z",
    ...extra,
  };
}

async function writeIdentity(path: string, identity: ReturnType<typeof createInstallIdentity>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(identity.record), { mode: 0o600 });
}
