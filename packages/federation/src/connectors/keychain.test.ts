import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileKeychain } from "./keychain.js";
import type { TokenBundle } from "./types.js";

const tempRoots: string[] = [];

async function tempKeychain(): Promise<FileKeychain> {
  const root = await mkdtemp(join(tmpdir(), "stacy-keychain-"));
  tempRoots.push(root);
  return new FileKeychain({ storePath: join(root, "tokens.json"), keyPath: join(root, "tokens.key") });
}

const sampleToken: TokenBundle = {
  accessToken: "gho_supersecretvalue123",
  scopes: ["repo", "read:org"],
  account: "octocat",
  obtainedAt: "2026-05-22T00:00:00.000Z",
};

describe("FileKeychain", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  it("round-trips a token through set/get", async () => {
    const keychain = await tempKeychain();
    await keychain.set("github:octocat", sampleToken);
    expect(await keychain.get("github:octocat")).toEqual(sampleToken);
  });

  it("stores tokens encrypted at rest", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-keychain-enc-"));
    tempRoots.push(root);
    const storePath = join(root, "tokens.json");
    const keychain = new FileKeychain({ storePath, keyPath: join(root, "tokens.key") });

    await keychain.set("github:octocat", sampleToken);
    const raw = await readFile(storePath, "utf8");

    expect(raw).not.toContain("gho_supersecretvalue123");
    expect(raw).toContain("ciphertext");
  });

  it("returns undefined for unknown accounts", async () => {
    const keychain = await tempKeychain();
    expect(await keychain.get("missing")).toBeUndefined();
  });

  it("lists and deletes stored accounts", async () => {
    const keychain = await tempKeychain();
    await keychain.set("github:a", sampleToken);
    await keychain.set("github:b", sampleToken);

    expect([...(await keychain.list())].sort()).toEqual(["github:a", "github:b"]);
    expect(await keychain.delete("github:a")).toBe(true);
    expect(await keychain.delete("github:a")).toBe(false);
    expect(await keychain.list()).toEqual(["github:b"]);
  });
});
