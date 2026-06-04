import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { collectFiles, excludeReason, normalizeExtAllowlist } from "./file-walk.js";

describe("excludeReason", () => {
  it("skips hidden segments and excluded dirs", () => {
    expect(excludeReason(".env")).toMatch(/hidden/);
    expect(excludeReason("docs/.secret/x.md")).toMatch(/hidden/);
    expect(excludeReason("node_modules/a/b.js")).toMatch(/excluded directory/);
    expect(excludeReason(".git/config")).toMatch(/hidden|excluded/);
  });

  it("keeps normal paths", () => {
    expect(excludeReason("docs/a.md")).toBeUndefined();
  });

  it("applies the ext allowlist", () => {
    const allow = normalizeExtAllowlist(["md", ".txt"]);
    expect(excludeReason("a.md", allow)).toBeUndefined();
    expect(excludeReason("a.txt", allow)).toBeUndefined();
    expect(excludeReason("a.json", allow)).toMatch(/not in --ext/);
  });
});

describe("collectFiles", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  async function fixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "stacy-file-walk-"));
    roots.push(root);
    await writeFile(join(root, "a.md"), "# a", "utf8");
    await writeFile(join(root, "b.txt"), "b", "utf8");
    await writeFile(join(root, "c.json"), "{}", "utf8");
    await mkdir(join(root, "sub"), { recursive: true });
    await writeFile(join(root, "sub", "d.md"), "# d", "utf8");
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "x", "utf8");
    await writeFile(join(root, ".hidden.md"), "secret", "utf8");
    return root;
  }

  it("recursively collects files, excluding node_modules and dotfiles", async () => {
    const root = await fixture();
    const { files, skipped } = collectFiles({ root });
    // root is under tmpdir (outside cwd) so labels collapse to leak-safe
    // basenames — assert on basenames, not the original subdir path.
    const names = files.map((f) => f.label.split("/").pop()).sort();
    expect(names).toContain("a.md");
    expect(names).toContain("d.md"); // from sub/, recursively walked
    expect(files.every((f) => !f.label.includes("node_modules"))).toBe(true);
    expect(files.every((f) => !f.label.includes(".hidden"))).toBe(true);
    expect(skipped.some((s) => s.reason.includes("excluded directory"))).toBe(true);
  });

  it("honors a glob pattern", async () => {
    const root = await fixture();
    const { files } = collectFiles({ root, glob: "**/*.md" });
    expect(files.every((f) => f.label.endsWith(".md"))).toBe(true);
    expect(files.length).toBe(2); // a.md + sub/d.md
  });

  it("honors the ext allowlist", async () => {
    const root = await fixture();
    const { files } = collectFiles({ root, ext: ["json"] });
    expect(files.map((f) => f.label.split("/").pop())).toEqual(["c.json"]);
  });

  it("skips symlinks", async () => {
    const root = await fixture();
    await symlink(join(root, "a.md"), join(root, "link.md"));
    const { files, skipped } = collectFiles({ root, glob: "*.md" });
    expect(files.some((f) => f.label.endsWith("link.md"))).toBe(false);
    expect(skipped.some((s) => s.reason === "symlink")).toBe(true);
  });

  it("returns empty for a directory with no matches", async () => {
    const root = await fixture();
    const { files } = collectFiles({ root, ext: ["rst"] });
    expect(files).toEqual([]);
  });
});
