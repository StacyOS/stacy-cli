import { describe, expect, it } from "vitest";

import { ConnectorRegistry } from "./registry.js";
import type { Connector, NormalizedObject } from "./types.js";

function mockConnector(id: string): Connector {
  return {
    id,
    displayName: id.toUpperCase(),
    authType: "oauth",
    scopes: ["repo"],
    objectKinds: [`${id}_object`],
    authenticate: async () => ({ accessToken: "t", scopes: ["repo"], obtainedAt: "now" }),
    refresh: async (token) => token,
    // eslint-disable-next-line require-yield
    async *ingest(): AsyncIterable<NormalizedObject> {
      return;
    },
    status: async () => ({ connected: true, scopes: ["repo"] }),
  };
}

describe("ConnectorRegistry", () => {
  it("registers and lists connector descriptors", () => {
    const registry = new ConnectorRegistry();
    registry.register(mockConnector("github"));

    expect(registry.list()).toEqual([
      {
        id: "github",
        displayName: "GITHUB",
        authType: "oauth",
        scopes: ["repo"],
        objectKinds: ["github_object"],
      },
    ]);
  });

  it("requires a known connector and reports available ids otherwise", () => {
    const registry = new ConnectorRegistry();
    registry.register(mockConnector("github"));

    expect(registry.require("github").id).toBe("github");
    expect(() => registry.require("slack")).toThrow('Unknown connector "slack". Available: github.');
  });

  it("rejects duplicate registration", () => {
    const registry = new ConnectorRegistry();
    registry.register(mockConnector("github"));
    expect(() => registry.register(mockConnector("github"))).toThrow("already registered");
  });
});
