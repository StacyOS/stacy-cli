import { describe, expect, it } from "vitest";

import type { Connector, NormalizedObject, TokenBundle } from "../src/connectors/types.js";
import type { KeychainStore } from "../src/connectors/keychain.js";
import { connectGithubCommand } from "./connect.js";
import {
  connectorsDisconnectCommand,
  connectorsListCommand,
  connectorsStatusCommand,
} from "./connectors.js";
import { ingestGithubCommand } from "./ingest.js";

class MemoryKeychain implements KeychainStore {
  private readonly store = new Map<string, TokenBundle>();
  async get(account: string) {
    return this.store.get(account);
  }
  async set(account: string, token: TokenBundle) {
    this.store.set(account, token);
  }
  async delete(account: string) {
    return this.store.delete(account);
  }
  async list() {
    return [...this.store.keys()];
  }
}

const token: TokenBundle = {
  accessToken: "gho_test",
  scopes: ["repo"],
  account: "octocat",
  obtainedAt: "2026-05-22T00:00:00.000Z",
};

function fakeConnector(objects: NormalizedObject[] = []): Connector {
  return {
    id: "github",
    displayName: "GitHub",
    authType: "oauth",
    scopes: ["repo"],
    objectKinds: ["github_pull_request", "github_issue"],
    authenticate: async (opts) => {
      opts.onUserPrompt?.({ verificationUri: "https://github.com/login/device", userCode: "ABCD-1234", expiresInSeconds: 900 });
      return token;
    },
    refresh: async (t) => t,
    async *ingest() {
      for (const object of objects) yield object;
    },
    status: async () => ({ connected: true, account: "octocat", scopes: ["repo"] }),
  };
}

function pullObject(number: number): NormalizedObject {
  return {
    kind: "github_pull_request",
    contentType: "application/json",
    content: { kind: "github_pull_request", number, title: `PR ${number}` },
    provenance: {
      connectorId: "github",
      connectorVersion: "0.2.0",
      sourceId: `github:pull:o/r#${number}`,
      sourceUrl: `https://github.com/o/r/pull/${number}`,
      sourceTimestamp: "2026-05-21T00:00:00Z",
    },
  };
}

describe("connectGithubCommand", () => {
  it("authenticates and stores the token in the keychain", async () => {
    const keychain = new MemoryKeychain();
    const lines: string[] = [];

    await connectGithubCommand(
      { dbUrl: "postgres://example", json: true },
      { keychain, connector: fakeConnector(), stdout: { log: (l) => lines.push(l) } },
    );

    expect(await keychain.get("github")).toEqual(token);
    expect(JSON.parse(lines[lines.length - 1] ?? "{}")).toMatchObject({ connector: "github", account: "octocat" });
  });
});

describe("connectors list/status/disconnect", () => {
  it("lists connectors with connection status", async () => {
    const keychain = new MemoryKeychain();
    await keychain.set("github", token);
    const lines: string[] = [];

    await connectorsListCommand(
      { dbUrl: "postgres://example", json: true },
      { keychain, stdout: { log: (l) => lines.push(l) } },
    );

    const parsed = JSON.parse(lines[0] ?? "{}") as { connectors: Array<{ id: string; connected: boolean }> };
    expect(parsed.connectors[0]).toMatchObject({ id: "github", connected: true });
  });

  it("reports not-connected status when no token is stored", async () => {
    const lines: string[] = [];
    await connectorsStatusCommand(
      { dbUrl: "postgres://example", json: true },
      { keychain: new MemoryKeychain(), connector: fakeConnector(), stdout: { log: (l) => lines.push(l) } },
    );
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ connected: false, connector: "github" });
  });

  it("disconnects a stored connector", async () => {
    const keychain = new MemoryKeychain();
    await keychain.set("github", token);
    const lines: string[] = [];

    await connectorsDisconnectCommand(
      "github",
      { dbUrl: "postgres://example", json: true },
      { keychain, stdout: { log: (l) => lines.push(l) } },
    );

    expect(await keychain.get("github")).toBeUndefined();
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ disconnected: true });
  });
});

describe("ingestGithubCommand", () => {
  it("ingests objects into signed KOs after confirmation", async () => {
    const keychain = new MemoryKeychain();
    await keychain.set("github", token);
    const stored: Array<{ eventType: string; koId: string }> = [];
    const lines: string[] = [];

    // Minimal fake db that records nothing but satisfies the store/receipt path
    // by using the real createLocalKnowledgeObject against an in-memory execute.
    const queries: unknown[] = [];
    const db = {
      execute: async (q: unknown) => {
        queries.push(q);
        return [];
      },
    };

    await ingestGithubCommand(
      { repo: "o/r", pulls: true, dbUrl: "postgres://example", json: true },
      {
        keychain,
        connector: fakeConnector([pullObject(231), pullObject(232)]),
        createDb: () => db,
        confirm: async () => true,
        now: new Date("2026-05-22T00:00:00.000Z"),
        stdout: { log: (l) => lines.push(l) },
      },
    );

    const result = JSON.parse(lines[0] ?? "{}") as { ingested: Array<{ kind: string }> };
    expect(result.ingested).toHaveLength(2);
    expect(result.ingested[0]).toMatchObject({ kind: "github_pull_request" });
    void stored;
  });

  it("aborts when confirmation is declined", async () => {
    const keychain = new MemoryKeychain();
    await keychain.set("github", token);
    const lines: string[] = [];
    let dbCreated = false;

    await ingestGithubCommand(
      { repo: "o/r", pulls: true, dbUrl: "postgres://example" },
      {
        keychain,
        connector: fakeConnector([pullObject(1)]),
        createDb: () => {
          dbCreated = true;
          return { execute: async () => [] };
        },
        confirm: async () => false,
        stdout: { log: (l) => lines.push(l) },
      },
    );

    expect(dbCreated).toBe(false);
    expect(lines.join("\n")).toContain("Ingestion cancelled.");
  });

  it("requires the connector to be connected", async () => {
    await expect(
      ingestGithubCommand(
        { repo: "o/r", pulls: true, dbUrl: "postgres://example" },
        { keychain: new MemoryKeychain(), connector: fakeConnector(), confirm: async () => true, stdout: { log: () => undefined } },
      ),
    ).rejects.toThrow("is not connected");
  });
});
