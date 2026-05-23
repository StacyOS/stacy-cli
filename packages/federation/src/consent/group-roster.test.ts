import { describe, expect, it } from "vitest";

import { createInstallIdentity } from "../identity/install-identity.js";
import {
  createGroupRoster,
  groupRosterIncludesInstall,
  verifyGroupRoster,
} from "./group-roster.js";

describe("signed group rosters", () => {
  it("creates and verifies a signed group roster", () => {
    const issuer = createInstallIdentity();
    const member = createInstallIdentity();
    const roster = createGroupRoster({
      tenant: "stacy/clinic",
      groupId: "group_eastside_specialty",
      label: "Eastside Specialty",
      members: [{ installId: member.record.installId, label: "Dr. Meera Patel", role: "clinician" }],
      issuerIdentity: issuer,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      idGenerator: () => "roster_eastside",
    });

    expect(roster.id).toBe("roster_eastside");
    expect(verifyGroupRoster(roster)).toEqual({
      ok: true,
      rosterHash: roster.signedPayload.rosterHash,
    });
    expect(groupRosterIncludesInstall(roster, member.record.installId, "clinician")).toBe(true);
  });

  it("rejects tampered roster membership", () => {
    const issuer = createInstallIdentity();
    const member = createInstallIdentity();
    const attacker = createInstallIdentity();
    const roster = createGroupRoster({
      tenant: "stacy/clinic",
      groupId: "group_eastside_specialty",
      label: "Eastside Specialty",
      members: [{ installId: member.record.installId }],
      issuerIdentity: issuer,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
    });

    expect(
      verifyGroupRoster({
        ...roster,
        signedPayload: {
          ...roster.signedPayload,
          members: [{ installId: attacker.record.installId }],
        },
      }),
    ).toEqual({ ok: false, reason: "Group roster hash mismatch" });
  });
});
