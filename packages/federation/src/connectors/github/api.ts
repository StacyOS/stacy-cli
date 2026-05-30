import { defaultHttpClient, type HttpClient } from "../http.js";
import type { SlidingWindowRateLimiter } from "../rate-limiter.js";
import { GITHUB_API_BASE_URL } from "./oauth.js";

export interface GitHubPullRequest {
  readonly number: number;
  readonly html_url: string;
  readonly title: string;
  readonly state: string;
  readonly user?: { readonly login?: string };
  readonly body?: string | null;
  readonly labels?: ReadonlyArray<{ readonly name?: string }>;
  readonly created_at: string;
  readonly updated_at: string;
  readonly additions?: number;
  readonly deletions?: number;
  readonly changed_files?: number;
}

export interface GitHubIssue {
  readonly number: number;
  readonly html_url: string;
  readonly title: string;
  readonly state: string;
  readonly user?: { readonly login?: string };
  readonly body?: string | null;
  readonly labels?: ReadonlyArray<{ readonly name?: string } | string>;
  readonly created_at: string;
  readonly updated_at: string;
  readonly pull_request?: unknown;
}

export interface GitHubApiOptions {
  readonly accessToken: string;
  readonly http?: HttpClient;
  readonly baseUrl?: string;
  readonly rateLimiter?: Pick<SlidingWindowRateLimiter, "acquire" | "noteRateLimitReset">;
}

export interface ListPullsParams {
  readonly owner: string;
  readonly repo: string;
  readonly state?: "open" | "closed" | "all";
  readonly perPage?: number;
}

export interface ListIssuesParams {
  readonly owner: string;
  readonly repo: string;
  readonly state?: "open" | "closed" | "all";
  readonly labels?: string;
  readonly since?: string;
  readonly perPage?: number;
}

/** Thin REST wrapper around the GitHub API with shared rate-limit handling. */
export class GitHubApi {
  private readonly accessToken: string;
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly rateLimiter?: Pick<SlidingWindowRateLimiter, "acquire" | "noteRateLimitReset">;

  constructor(options: GitHubApiOptions) {
    this.accessToken = options.accessToken;
    this.http = options.http ?? defaultHttpClient;
    this.baseUrl = options.baseUrl ?? GITHUB_API_BASE_URL;
    this.rateLimiter = options.rateLimiter;
  }

  async getAuthenticatedUser(): Promise<{ login?: string }> {
    return (await this.request(`${this.baseUrl}/user`)) as { login?: string };
  }

  async listPullRequests(params: ListPullsParams): Promise<readonly GitHubPullRequest[]> {
    const query = new URLSearchParams({
      state: params.state ?? "open",
      per_page: String(params.perPage ?? 100),
      sort: "updated",
      direction: "desc",
    });
    const url = `${this.baseUrl}/repos/${params.owner}/${params.repo}/pulls?${query.toString()}`;
    return (await this.request(url)) as readonly GitHubPullRequest[];
  }

  async listIssues(params: ListIssuesParams): Promise<readonly GitHubIssue[]> {
    const query = new URLSearchParams({
      state: params.state ?? "open",
      per_page: String(params.perPage ?? 100),
      sort: "updated",
      direction: "desc",
    });
    if (params.labels) query.set("labels", params.labels);
    if (params.since) query.set("since", params.since);
    const url = `${this.baseUrl}/repos/${params.owner}/${params.repo}/issues?${query.toString()}`;
    const issues = (await this.request(url)) as readonly GitHubIssue[];
    // The issues endpoint also returns PRs; filter them out.
    return issues.filter((issue) => issue.pull_request === undefined);
  }

  private async request(url: string): Promise<unknown> {
    await this.rateLimiter?.acquire();
    const response = await this.http(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.accessToken}`,
        "User-Agent": "stacy-cli",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    const remaining = response.headerGet("x-ratelimit-remaining");
    const reset = response.headerGet("x-ratelimit-reset");
    if (remaining === "0" && reset) {
      this.rateLimiter?.noteRateLimitReset(Number.parseInt(reset, 10) * 1000);
    }

    if (response.status === 401) {
      throw new Error("GitHub rejected the stored token (401). Reconnect with `stacy connect github`.");
    }
    if (!response.ok) {
      throw new Error(`GitHub API request failed (${response.status}): ${await safeText(response)}`);
    }
    return response.json();
  }
}

async function safeText(response: { text(): Promise<string> }): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return "";
  }
}
