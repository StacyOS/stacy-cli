import type { CanonicalJsonValue } from "../../crypto/canonical.js";
import type { NormalizedObject } from "../types.js";
import type { GitHubIssue, GitHubPullRequest } from "./api.js";

export const GITHUB_CONNECTOR_ID = "github";
export const GITHUB_CONNECTOR_VERSION = "0.2.0";
export const GITHUB_PULL_REQUEST_KIND = "github_pull_request";
export const GITHUB_ISSUE_KIND = "github_issue";

export interface NormalizeContext {
  readonly owner: string;
  readonly repo: string;
  readonly ingestCommand?: string;
}

export function normalizePullRequest(
  pull: GitHubPullRequest,
  context: NormalizeContext,
): NormalizedObject {
  const content: CanonicalJsonValue = {
    kind: GITHUB_PULL_REQUEST_KIND,
    schemaVersion: 1,
    url: pull.html_url,
    number: pull.number,
    title: pull.title,
    state: pull.state,
    author: pull.user?.login ?? null,
    body: pull.body ?? null,
    labels: (pull.labels ?? []).map((label) => label.name ?? "").filter(Boolean),
    files_changed: pull.changed_files ?? null,
    additions: pull.additions ?? null,
    deletions: pull.deletions ?? null,
    created_at: pull.created_at,
    updated_at: pull.updated_at,
  };

  return {
    kind: GITHUB_PULL_REQUEST_KIND,
    contentType: "application/json",
    content,
    provenance: {
      connectorId: GITHUB_CONNECTOR_ID,
      connectorVersion: GITHUB_CONNECTOR_VERSION,
      sourceId: `github:pull:${context.owner}/${context.repo}#${pull.number}`,
      sourceUrl: pull.html_url,
      sourceTimestamp: pull.updated_at,
      ingestCommand: context.ingestCommand,
    },
  };
}

export function normalizeIssue(issue: GitHubIssue, context: NormalizeContext): NormalizedObject {
  const content: CanonicalJsonValue = {
    kind: GITHUB_ISSUE_KIND,
    schemaVersion: 1,
    url: issue.html_url,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    author: issue.user?.login ?? null,
    body: issue.body ?? null,
    labels: (issue.labels ?? [])
      .map((label) => (typeof label === "string" ? label : label.name ?? ""))
      .filter(Boolean),
    created_at: issue.created_at,
    updated_at: issue.updated_at,
  };

  return {
    kind: GITHUB_ISSUE_KIND,
    contentType: "application/json",
    content,
    provenance: {
      connectorId: GITHUB_CONNECTOR_ID,
      connectorVersion: GITHUB_CONNECTOR_VERSION,
      sourceId: `github:issue:${context.owner}/${context.repo}#${issue.number}`,
      sourceUrl: issue.html_url,
      sourceTimestamp: issue.updated_at,
      ingestCommand: context.ingestCommand,
    },
  };
}
