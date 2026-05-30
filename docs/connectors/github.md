# Connector Reference: GitHub

The GitHub connector ingests pull requests and issues as signed Knowledge
Objects. It is the first concrete implementation of the
[connector framework](../concepts/connectors.md).

| Field | Value |
|---|---|
| id | `github` |
| auth | OAuth device-code flow |
| scopes | `repo` |
| object kinds | `github_pull_request`, `github_issue` |
| connector version | `0.2.0` |

## Setup

You need a GitHub OAuth app client id. Provide it via `--client-id` or the
`STACY_GITHUB_CLIENT_ID` environment variable.

```bash
export STACY_GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxx
stacy connect github
```

The device-code flow prints a verification URL and a short code; authorize in
the browser and the token is stored encrypted at rest. Restrict to a single
organization with `--org <org>`.

## Ingestion

```bash
stacy ingest github --repo <owner/name> [options]
```

| Option | Meaning | Default |
|---|---|---|
| `--repo <owner/name>` | Repository to ingest (required) | — |
| `--pulls` | Ingest pull requests | on when neither flag given |
| `--issues` | Ingest issues | off |
| `--state <open\|closed\|all>` | Filter by state | `open` |
| `--label <label>` | Only objects with this label | — |
| `--since <7d\|24h\|ISO>` | Only objects updated since | — |
| `--yes` | Skip the confirmation prompt | off |
| `--json` | Machine-readable output | off |

Ingestion fetches and normalizes first, shows a confirmation summary with the
estimated object count, and only then writes signed KOs. Issues that are
actually pull requests are filtered out of the issue stream.

## Object shapes

Each object is normalized to a stable JSON shape and addressed by content hash.
Provenance records the source:

```jsonc
{
  "connectorId": "github",
  "connectorVersion": "0.2.0",
  "sourceId": "github:pull:octocat/hello-world#231",
  "sourceUrl": "https://github.com/octocat/hello-world/pull/231",
  "sourceTimestamp": "2026-05-21T00:00:00Z",
  "ingestCommand": "stacy ingest github --repo octocat/hello-world --pulls"
}
```

## Token management

```bash
stacy connectors status              # live token check: account + scopes
stacy connectors disconnect github   # remove the stored token
```

The connector reads GitHub's `x-ratelimit-remaining` / `x-ratelimit-reset`
headers and feeds them into the shared sliding-window rate limiter, persisting
the reset deadline across restarts. On a `401` it tells you to reconnect with
`stacy connect github`.

## Using ingested objects in an AI run

```bash
stacy run "Summarize open PRs" --use <ko_id> --use <ko_id> --ack-egress
```

See [AI runs](../concepts/ai-runs.md).
