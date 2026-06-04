import { defaultHttpClient, type HttpClient } from "../http.js";
import { SlidingWindowRateLimiter } from "../rate-limiter.js";
import type {
  AuthenticateOptions,
  Connector,
  IngestOptions,
  NormalizedObject,
  StatusReport,
  TokenBundle,
} from "../types.js";
import { GitHubApi } from "./api.js";
import {
  GITHUB_CONNECTOR_ID,
  GITHUB_ISSUE_KIND,
  GITHUB_PULL_REQUEST_KIND,
  normalizeIssue,
  normalizePullRequest,
} from "./normalize.js";
import {
  authenticateWithDeviceFlow,
  GITHUB_API_BASE_URL,
  type GitHubOAuthConfig,
} from "./oauth.js";

export interface GitHubIngestParams {
  readonly repo: string;
  readonly pulls?: boolean;
  readonly issues?: boolean;
  readonly state?: "open" | "closed" | "all";
  readonly label?: string;
  readonly since?: string;
  readonly ingestCommand?: string;
}

export interface GitHubConnectorOptions {
  readonly clientId: string;
  readonly scopes?: readonly string[];
  readonly http?: HttpClient;
  readonly apiBaseUrl?: string;
  readonly rateLimiter?: SlidingWindowRateLimiter;
  /** Test seams forwarded to the device-code flow. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const DEFAULT_SCOPES = ["repo", "read:org"] as const;

export class GitHubConnector implements Connector {
  readonly id = GITHUB_CONNECTOR_ID;
  readonly displayName = "GitHub";
  readonly authType = "oauth" as const;
  readonly scopes: readonly string[];
  readonly objectKinds = [GITHUB_PULL_REQUEST_KIND, GITHUB_ISSUE_KIND];

  private readonly options: GitHubConnectorOptions;

  constructor(options: GitHubConnectorOptions) {
    this.options = options;
    this.scopes = options.scopes ?? [...DEFAULT_SCOPES];
  }

  authenticate(opts: AuthenticateOptions): Promise<TokenBundle> {
    const config: GitHubOAuthConfig = {
      clientId: this.options.clientId,
      scopes: this.scopes,
      http: this.options.http,
      apiBaseUrl: this.options.apiBaseUrl,
      sleep: this.options.sleep,
      now: this.options.now,
    };
    return authenticateWithDeviceFlow(config, opts);
  }

  async refresh(token: TokenBundle): Promise<TokenBundle> {
    // GitHub OAuth app tokens for the device flow are long-lived and not
    // refreshable without GitHub App installation tokens. Return as-is.
    return token;
  }

  async status(token: TokenBundle): Promise<StatusReport> {
    const api = this.api(token);
    try {
      const user = await api.getAuthenticatedUser();
      return {
        connected: true,
        account: user.login ?? token.account,
        scopes: token.scopes,
        expiresAt: token.expiresAt,
      };
    } catch {
      return { connected: false, account: token.account, scopes: token.scopes };
    }
  }

  async *ingest(opts: IngestOptions): AsyncIterable<NormalizedObject> {
    const params = opts.params as unknown as GitHubIngestParams;
    const { owner, repo } = parseRepo(params.repo);
    const api = this.api(opts.token);
    const context = { owner, repo, ingestCommand: params.ingestCommand };
    const wantPulls = params.pulls ?? true;
    const wantIssues = params.issues ?? false;

    if (wantPulls) {
      const pulls = await api.listPullRequests({ owner, repo, state: params.state });
      for (const pull of pulls) {
        if (opts.signal?.aborted) return;
        if (params.label && !(pull.labels ?? []).some((l) => l.name === params.label)) continue;
        if (params.since && pull.updated_at < params.since) continue;
        yield normalizePullRequest(pull, context);
      }
    }

    if (wantIssues) {
      const issues = await api.listIssues({
        owner,
        repo,
        state: params.state,
        labels: params.label,
        since: params.since,
      });
      for (const issue of issues) {
        if (opts.signal?.aborted) return;
        yield normalizeIssue(issue, context);
      }
    }
  }

  private api(token: TokenBundle): GitHubApi {
    return new GitHubApi({
      accessToken: token.accessToken,
      http: this.options.http ?? defaultHttpClient,
      baseUrl: this.options.apiBaseUrl ?? GITHUB_API_BASE_URL,
      rateLimiter: this.options.rateLimiter,
    });
  }
}

export function parseRepo(value: string): { owner: string; repo: string } {
  const trimmed = value?.trim() ?? "";
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid --repo "${value}". Expected "owner/name".`);
  }
  return { owner: match[1] as string, repo: match[2] as string };
}
