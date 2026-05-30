import { describe, expect, it } from "vitest";

import type { HttpClient, HttpResponse } from "../http.js";
import { GitHubConnector, parseRepo } from "./connector.js";
import { authenticateWithDeviceFlow } from "./oauth.js";

interface MockReply {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

function reply(value: MockReply): HttpResponse {
  const status = value.status ?? 200;
  const headers = value.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value.body,
    text: async () => JSON.stringify(value.body),
    headerGet: (name) => headers[name.toLowerCase()] ?? null,
  };
}

/** Routes requests to a handler keyed by URL substring. */
function mockHttp(handler: (url: string, init?: { body?: string }) => MockReply): HttpClient {
  return async (url, init) => reply(handler(url, init));
}

const noopSleep = async () => undefined;

describe("authenticateWithDeviceFlow", () => {
  it("walks the device-code flow through authorization_pending to a token", async () => {
    let tokenPolls = 0;
    const prompts: string[] = [];
    const http = mockHttp((url) => {
      if (url.includes("/login/device/code")) {
        return {
          body: {
            device_code: "dev123",
            user_code: "ABCD-1234",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          },
        };
      }
      if (url.includes("/login/oauth/access_token")) {
        tokenPolls += 1;
        if (tokenPolls < 2) return { body: { error: "authorization_pending" } };
        return { body: { access_token: "gho_abc", token_type: "bearer", scope: "repo,read:org" } };
      }
      if (url.endsWith("/user")) {
        return { body: { login: "octocat" } };
      }
      throw new Error(`unexpected url ${url}`);
    });

    const token = await authenticateWithDeviceFlow(
      { clientId: "cid", scopes: ["repo", "read:org"], http, sleep: noopSleep, now: () => 0 },
      { onUserPrompt: (p) => prompts.push(p.userCode) },
    );

    expect(prompts).toEqual(["ABCD-1234"]);
    expect(token).toMatchObject({ accessToken: "gho_abc", account: "octocat", scopes: ["repo", "read:org"] });
    expect(tokenPolls).toBe(2);
  });

  it("throws when authorization is denied", async () => {
    const http = mockHttp((url) => {
      if (url.includes("/login/device/code")) {
        return {
          body: {
            device_code: "d",
            user_code: "U",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 1,
          },
        };
      }
      return { body: { error: "access_denied" } };
    });

    await expect(
      authenticateWithDeviceFlow({ clientId: "cid", scopes: ["repo"], http, sleep: noopSleep, now: () => 0 }, {}),
    ).rejects.toThrow("authorization was denied");
  });
});

describe("GitHubConnector.ingest", () => {
  const token = { accessToken: "gho_abc", scopes: ["repo"], obtainedAt: "2026-05-22T00:00:00.000Z" };

  it("normalizes pull requests and applies label + since filters", async () => {
    const http = mockHttp((url) => {
      if (url.includes("/pulls")) {
        return {
          headers: { "x-ratelimit-remaining": "4999" },
          body: [
            {
              number: 231,
              html_url: "https://github.com/o/r/pull/231",
              title: "Add feature",
              state: "open",
              user: { login: "dev" },
              labels: [{ name: "needs-review" }],
              created_at: "2026-05-20T00:00:00Z",
              updated_at: "2026-05-21T00:00:00Z",
            },
            {
              number: 200,
              html_url: "https://github.com/o/r/pull/200",
              title: "Old PR",
              state: "open",
              labels: [{ name: "chore" }],
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-02T00:00:00Z",
            },
          ],
        };
      }
      throw new Error(`unexpected url ${url}`);
    });
    const connector = new GitHubConnector({ clientId: "cid", http });

    const out = [];
    for await (const obj of connector.ingest({
      token,
      params: { repo: "o/r", pulls: true, label: "needs-review", since: "2026-05-01T00:00:00Z" },
    })) {
      out.push(obj);
    }

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "github_pull_request",
      contentType: "application/json",
      provenance: { connectorId: "github", sourceId: "github:pull:o/r#231" },
    });
    expect((out[0]?.content as { title: string }).title).toBe("Add feature");
  });

  it("ingests issues and excludes pull requests returned by the issues endpoint", async () => {
    const http = mockHttp((url) => {
      if (url.includes("/issues")) {
        return {
          body: [
            {
              number: 9,
              html_url: "https://github.com/o/r/issues/9",
              title: "Bug",
              state: "open",
              created_at: "2026-05-20T00:00:00Z",
              updated_at: "2026-05-21T00:00:00Z",
            },
            {
              number: 231,
              html_url: "https://github.com/o/r/pull/231",
              title: "PR masquerading as issue",
              state: "open",
              pull_request: { url: "x" },
              created_at: "2026-05-20T00:00:00Z",
              updated_at: "2026-05-21T00:00:00Z",
            },
          ],
        };
      }
      throw new Error(`unexpected url ${url}`);
    });
    const connector = new GitHubConnector({ clientId: "cid", http });

    const out = [];
    for await (const obj of connector.ingest({ token, params: { repo: "o/r", pulls: false, issues: true } })) {
      out.push(obj);
    }

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "github_issue", provenance: { sourceId: "github:issue:o/r#9" } });
  });
});

describe("parseRepo", () => {
  it("parses owner/name", () => {
    expect(parseRepo("StacyOS/stacy-cli")).toEqual({ owner: "StacyOS", repo: "stacy-cli" });
  });

  it("rejects malformed values", () => {
    expect(() => parseRepo("not-a-repo")).toThrow('Invalid --repo "not-a-repo"');
  });
});
