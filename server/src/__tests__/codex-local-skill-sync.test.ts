import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listCodexSkills,
  syncCodexSkills,
} from "@arpanstacy/stacy-adapter-codex-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("codex local skill sync", () => {
  const stacyKey = "stacy/skills/stacy";
  const createAgentKey = "stacy/skills/stacy-create-agent";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("reports configured Stacy skills for workspace injection on the next run", async () => {
    const codexHome = await makeTempDir("stacy-codex-skill-sync-");
    cleanupDirs.add(codexHome);

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        stacySkillSync: {
          desiredSkills: [stacyKey],
        },
      },
    } as const;

    const before = await listCodexSkills(ctx);
    expect(before.mode).toBe("ephemeral");
    expect(before.desiredSkills).toContain(stacyKey);
    expect(before.desiredSkills).toContain(createAgentKey);
    expect(before.entries.find((entry) => entry.key === stacyKey)?.required).toBe(true);
    expect(before.entries.find((entry) => entry.key === stacyKey)?.state).toBe("configured");
    expect(before.entries.find((entry) => entry.key === createAgentKey)?.required).toBe(true);
    expect(before.entries.find((entry) => entry.key === createAgentKey)?.state).toBe("configured");
    expect(before.entries.find((entry) => entry.key === stacyKey)?.detail).toContain("CODEX_HOME/skills/");
  });

  it("does not persist Stacy skills into CODEX_HOME during sync", async () => {
    const codexHome = await makeTempDir("stacy-codex-skill-prune-");
    cleanupDirs.add(codexHome);

    const configuredCtx = {
      agentId: "agent-2",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        stacySkillSync: {
          desiredSkills: [stacyKey],
        },
      },
    } as const;

    const after = await syncCodexSkills(configuredCtx, [stacyKey]);
    expect(after.mode).toBe("ephemeral");
    expect(after.entries.find((entry) => entry.key === stacyKey)?.state).toBe("configured");
    await expect(fs.lstat(path.join(codexHome, "skills", "stacy"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("keeps required bundled Stacy skills configured even when the desired set is emptied", async () => {
    const codexHome = await makeTempDir("stacy-codex-skill-required-");
    cleanupDirs.add(codexHome);

    const configuredCtx = {
      agentId: "agent-2",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        stacySkillSync: {
          desiredSkills: [],
        },
      },
    } as const;

    const after = await syncCodexSkills(configuredCtx, []);
    expect(after.desiredSkills).toContain(stacyKey);
    expect(after.desiredSkills).toContain(createAgentKey);
    expect(after.entries.find((entry) => entry.key === stacyKey)?.state).toBe("configured");
    expect(after.entries.find((entry) => entry.key === createAgentKey)?.state).toBe("configured");
  });

  it("normalizes legacy flat Stacy skill refs before reporting configured state", async () => {
    const codexHome = await makeTempDir("stacy-codex-legacy-skill-sync-");
    cleanupDirs.add(codexHome);

    const snapshot = await listCodexSkills({
      agentId: "agent-3",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        stacySkillSync: {
          desiredSkills: ["stacy"],
        },
      },
    });

    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.desiredSkills).toContain(stacyKey);
    expect(snapshot.desiredSkills).not.toContain("stacy");
    expect(snapshot.entries.find((entry) => entry.key === stacyKey)?.state).toBe("configured");
    expect(snapshot.entries.find((entry) => entry.key === "stacy")).toBeUndefined();
  });
});
