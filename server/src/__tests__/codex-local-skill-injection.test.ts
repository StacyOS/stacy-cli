import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureCodexSkillsInjected } from "@arpanstacy/stacy-adapter-codex-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createStacyRepoSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "server"), { recursive: true });
  await fs.mkdir(path.join(root, "packages", "adapter-utils"), { recursive: true });
  await fs.mkdir(path.join(root, "skills", skillName), { recursive: true });
  await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
  await fs.writeFile(path.join(root, "package.json"), '{"name":"stacy"}\n', "utf8");
  await fs.writeFile(
    path.join(root, "skills", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

async function createCustomSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "custom", skillName), { recursive: true });
  await fs.writeFile(
    path.join(root, "custom", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

describe("codex local adapter skill injection", () => {
  const stacyKey = "stacy/skills/stacy";
  const createAgentKey = "stacy/skills/stacy-create-agent";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("repairs a Codex Stacy skill symlink that still points at another live checkout", async () => {
    const currentRepo = await makeTempDir("stacy-codex-current-");
    const oldRepo = await makeTempDir("stacy-codex-old-");
    const skillsHome = await makeTempDir("stacy-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createStacyRepoSkill(currentRepo, "stacy");
    await createStacyRepoSkill(currentRepo, "stacy-create-agent");
    await createStacyRepoSkill(oldRepo, "stacy");
    await fs.symlink(path.join(oldRepo, "skills", "stacy"), path.join(skillsHome, "stacy"));

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [
          {
            key: stacyKey,
            runtimeName: "stacy",
            source: path.join(currentRepo, "skills", "stacy"),
          },
          {
            key: createAgentKey,
            runtimeName: "stacy-create-agent",
            source: path.join(currentRepo, "skills", "stacy-create-agent"),
          },
        ],
      },
    );

    expect(await fs.realpath(path.join(skillsHome, "stacy"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "stacy")),
    );
    expect(await fs.realpath(path.join(skillsHome, "stacy-create-agent"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "stacy-create-agent")),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Repaired Codex skill "stacy"'),
      }),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Injected Codex skill "stacy-create-agent"'),
      }),
    );
  });

  it("preserves a custom Codex skill symlink outside Stacy repo checkouts", async () => {
    const currentRepo = await makeTempDir("stacy-codex-current-");
    const customRoot = await makeTempDir("stacy-codex-custom-");
    const skillsHome = await makeTempDir("stacy-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(customRoot);
    cleanupDirs.add(skillsHome);

    await createStacyRepoSkill(currentRepo, "stacy");
    await createCustomSkill(customRoot, "stacy");
    await fs.symlink(path.join(customRoot, "custom", "stacy"), path.join(skillsHome, "stacy"));

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: stacyKey,
        runtimeName: "stacy",
        source: path.join(currentRepo, "skills", "stacy"),
      }],
    });

    expect(await fs.realpath(path.join(skillsHome, "stacy"))).toBe(
      await fs.realpath(path.join(customRoot, "custom", "stacy")),
    );
  });

  it("prunes broken symlinks for unavailable Stacy repo skills before Codex starts", async () => {
    const currentRepo = await makeTempDir("stacy-codex-current-");
    const oldRepo = await makeTempDir("stacy-codex-old-");
    const skillsHome = await makeTempDir("stacy-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createStacyRepoSkill(currentRepo, "stacy");
    await createStacyRepoSkill(oldRepo, "agent-browser");
    const staleTarget = path.join(oldRepo, "skills", "agent-browser");
    await fs.symlink(staleTarget, path.join(skillsHome, "agent-browser"));
    await fs.rm(staleTarget, { recursive: true, force: true });

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [{
          key: stacyKey,
          runtimeName: "stacy",
          source: path.join(currentRepo, "skills", "stacy"),
        }],
      },
    );

    await expect(fs.lstat(path.join(skillsHome, "agent-browser"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Removed stale Codex skill "agent-browser"'),
      }),
    );
  });

  it("preserves other live Stacy skill symlinks in the shared workspace skill directory", async () => {
    const currentRepo = await makeTempDir("stacy-codex-current-");
    const skillsHome = await makeTempDir("stacy-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(skillsHome);

    await createStacyRepoSkill(currentRepo, "stacy");
    await createStacyRepoSkill(currentRepo, "agent-browser");
    await fs.symlink(
      path.join(currentRepo, "skills", "agent-browser"),
      path.join(skillsHome, "agent-browser"),
    );

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: stacyKey,
        runtimeName: "stacy",
        source: path.join(currentRepo, "skills", "stacy"),
      }],
    });

    expect((await fs.lstat(path.join(skillsHome, "stacy"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(skillsHome, "agent-browser"))).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(path.join(skillsHome, "agent-browser"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "agent-browser")),
    );
  });
});
