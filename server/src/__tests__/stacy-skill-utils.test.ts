import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listStacySkillEntries,
  removeMaintainerOnlySkillSymlinks,
} from "@arpanstacy/stacy-adapter-utils/server-utils";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("stacy skill utils", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("lists bundled runtime skills from ./skills without pulling in .agents/skills", async () => {
    const root = await makeTempDir("stacy-skill-roots-");
    cleanupDirs.add(root);

    const moduleDir = path.join(root, "a", "b", "c", "d", "e");
    await fs.mkdir(moduleDir, { recursive: true });
    await fs.mkdir(path.join(root, "skills", "stacy"), { recursive: true });
    await fs.mkdir(path.join(root, "skills", "stacy-create-agent"), { recursive: true });
    await fs.mkdir(path.join(root, ".agents", "skills", "release"), { recursive: true });

    const entries = await listStacySkillEntries(moduleDir);

    expect(entries.map((entry) => entry.key)).toEqual([
      "stacy/skills/stacy",
      "stacy/skills/stacy-create-agent",
    ]);
    expect(entries.map((entry) => entry.runtimeName)).toEqual([
      "stacy",
      "stacy-create-agent",
    ]);
    expect(entries[0]?.source).toBe(path.join(root, "skills", "stacy"));
    expect(entries[1]?.source).toBe(path.join(root, "skills", "stacy-create-agent"));
  });

  it("marks skills with required: false in SKILL.md frontmatter as optional", async () => {
    const root = await makeTempDir("stacy-skill-optional-");
    cleanupDirs.add(root);

    const moduleDir = path.join(root, "a", "b", "c", "d", "e");
    await fs.mkdir(moduleDir, { recursive: true });

    // Required skill (no frontmatter flag)
    const requiredDir = path.join(root, "skills", "stacy");
    await fs.mkdir(requiredDir, { recursive: true });
    await fs.writeFile(path.join(requiredDir, "SKILL.md"), "---\nname: stacy\n---\n\n# Stacy\n");

    // Optional skill (required: false)
    const optionalDir = path.join(root, "skills", "stacy-dev");
    await fs.mkdir(optionalDir, { recursive: true });
    await fs.writeFile(path.join(optionalDir, "SKILL.md"), "---\nname: stacy-dev\nrequired: false\n---\n\n# Dev\n");

    const entries = await listStacySkillEntries(moduleDir);
    entries.sort((a, b) => a.runtimeName.localeCompare(b.runtimeName));

    expect(entries).toHaveLength(2);
    expect(entries[0]?.runtimeName).toBe("stacy");
    expect(entries[0]?.required).toBe(true);
    expect(entries[1]?.runtimeName).toBe("stacy-dev");
    expect(entries[1]?.required).toBe(false);
    expect(entries[1]?.requiredReason).toBeNull();
  });

  it("removes stale maintainer-only symlinks from a shared skills home", async () => {
    const root = await makeTempDir("stacy-skill-cleanup-");
    cleanupDirs.add(root);

    const skillsHome = path.join(root, "skills-home");
    const runtimeSkill = path.join(root, "skills", "stacy");
    const customSkill = path.join(root, "custom", "release-notes");
    const staleMaintainerSkill = path.join(root, ".agents", "skills", "release");

    await fs.mkdir(skillsHome, { recursive: true });
    await fs.mkdir(runtimeSkill, { recursive: true });
    await fs.mkdir(customSkill, { recursive: true });

    await fs.symlink(runtimeSkill, path.join(skillsHome, "stacy"));
    await fs.symlink(customSkill, path.join(skillsHome, "release-notes"));
    await fs.symlink(staleMaintainerSkill, path.join(skillsHome, "release"));

    const removed = await removeMaintainerOnlySkillSymlinks(skillsHome, ["stacy"]);

    expect(removed).toEqual(["release"]);
    await expect(fs.lstat(path.join(skillsHome, "release"))).rejects.toThrow();
    expect((await fs.lstat(path.join(skillsHome, "stacy"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(skillsHome, "release-notes"))).isSymbolicLink()).toBe(true);
  });
});
