import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listCursorSkills,
  syncCursorSkills,
} from "@arpanstacy/stacy-adapter-cursor-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createSkillDir(root: string, name: string) {
  const skillDir = path.join(root, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: ${name}\n---\n`, "utf8");
  return skillDir;
}

describe("cursor local skill sync", () => {
  const stacyKey = "stacy/skills/stacy";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("reports configured Stacy skills and installs them into the Cursor skills home", async () => {
    const home = await makeTempDir("stacy-cursor-skill-sync-");
    cleanupDirs.add(home);

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "cursor",
      config: {
        env: {
          HOME: home,
        },
        stacySkillSync: {
          desiredSkills: [stacyKey],
        },
      },
    } as const;

    const before = await listCursorSkills(ctx);
    expect(before.mode).toBe("persistent");
    expect(before.desiredSkills).toContain(stacyKey);
    expect(before.entries.find((entry) => entry.key === stacyKey)?.required).toBe(true);
    expect(before.entries.find((entry) => entry.key === stacyKey)?.state).toBe("missing");

    const after = await syncCursorSkills(ctx, [stacyKey]);
    expect(after.entries.find((entry) => entry.key === stacyKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".cursor", "skills", "stacy"))).isSymbolicLink()).toBe(true);
  });

  it("recognizes company-library runtime skills supplied outside the bundled Stacy directory", async () => {
    const home = await makeTempDir("stacy-cursor-runtime-skills-home-");
    const runtimeSkills = await makeTempDir("stacy-cursor-runtime-skills-src-");
    cleanupDirs.add(home);
    cleanupDirs.add(runtimeSkills);

    const stacyDir = await createSkillDir(runtimeSkills, "stacy");
    const asciiHeartDir = await createSkillDir(runtimeSkills, "ascii-heart");

    const ctx = {
      agentId: "agent-3",
      companyId: "company-1",
      adapterType: "cursor",
      config: {
        env: {
          HOME: home,
        },
        stacyRuntimeSkills: [
          {
            key: "stacy",
            runtimeName: "stacy",
            source: stacyDir,
            required: true,
            requiredReason: "Bundled Stacy skills are always available for local adapters.",
          },
          {
            key: "ascii-heart",
            runtimeName: "ascii-heart",
            source: asciiHeartDir,
          },
        ],
        stacySkillSync: {
          desiredSkills: ["ascii-heart"],
        },
      },
    } as const;

    const before = await listCursorSkills(ctx);
    expect(before.warnings).toEqual([]);
    expect(before.desiredSkills).toEqual(["stacy", "ascii-heart"]);
    expect(before.entries.find((entry) => entry.key === "ascii-heart")?.state).toBe("missing");

    const after = await syncCursorSkills(ctx, ["ascii-heart"]);
    expect(after.warnings).toEqual([]);
    expect(after.entries.find((entry) => entry.key === "ascii-heart")?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".cursor", "skills", "ascii-heart"))).isSymbolicLink()).toBe(true);
  });

  it("keeps required bundled Stacy skills installed even when the desired set is emptied", async () => {
    const home = await makeTempDir("stacy-cursor-skill-prune-");
    cleanupDirs.add(home);

    const configuredCtx = {
      agentId: "agent-2",
      companyId: "company-1",
      adapterType: "cursor",
      config: {
        env: {
          HOME: home,
        },
        stacySkillSync: {
          desiredSkills: [stacyKey],
        },
      },
    } as const;

    await syncCursorSkills(configuredCtx, [stacyKey]);

    const clearedCtx = {
      ...configuredCtx,
      config: {
        env: {
          HOME: home,
        },
        stacySkillSync: {
          desiredSkills: [],
        },
      },
    } as const;

    const after = await syncCursorSkills(clearedCtx, []);
    expect(after.desiredSkills).toContain(stacyKey);
    expect(after.entries.find((entry) => entry.key === stacyKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".cursor", "skills", "stacy"))).isSymbolicLink()).toBe(true);
  });
});
