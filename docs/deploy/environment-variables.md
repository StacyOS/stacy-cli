---
title: Environment Variables
summary: Full environment variable reference
---

All environment variables that Stacy uses for server configuration.

## Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port |
| `STACY_BIND` | `loopback` | Reachability preset: `loopback`, `lan`, `tailnet`, or `custom` |
| `STACY_BIND_HOST` | (unset) | Required when `STACY_BIND=custom` |
| `HOST` | `127.0.0.1` | Legacy host override; prefer `STACY_BIND` for new setups |
| `DATABASE_URL` | (embedded) | PostgreSQL connection string |
| `STACY_HOME` | `~/.stacy` | Base directory for all Stacy data |
| `STACY_INSTANCE_ID` | `default` | Instance identifier (for multiple local instances) |
| `STACY_DEPLOYMENT_MODE` | `local_trusted` | Runtime mode override |
| `STACY_DEPLOYMENT_EXPOSURE` | `private` | Exposure policy when deployment mode is `authenticated` |
| `STACY_API_URL` | (auto-derived) | Stacy API base URL. When set externally (e.g., via Kubernetes ConfigMap, load balancer, or reverse proxy), the server preserves the value instead of deriving it from the listen host and port. Useful for deployments where the public-facing URL differs from the local bind address. |

## Secrets

| Variable | Default | Description |
|----------|---------|-------------|
| `STACY_SECRETS_MASTER_KEY` | (from file) | 32-byte encryption key (base64/hex/raw) |
| `STACY_SECRETS_MASTER_KEY_FILE` | `~/.stacy/.../secrets/master.key` | Path to key file |
| `STACY_SECRETS_STRICT_MODE` | `false` | Require secret refs for sensitive env vars |

## Agent Runtime (Injected into agent processes)

These are set automatically by the server when invoking agents:

| Variable | Description |
|----------|-------------|
| `STACY_AGENT_ID` | Agent's unique ID |
| `STACY_COMPANY_ID` | Company ID |
| `STACY_API_URL` | Stacy API base URL (inherits the server-level value; see Server Configuration above) |
| `STACY_API_KEY` | Short-lived JWT for API auth |
| `STACY_RUN_ID` | Current heartbeat run ID |
| `STACY_TASK_ID` | Issue that triggered this wake |
| `STACY_WAKE_REASON` | Wake trigger reason |
| `STACY_WAKE_COMMENT_ID` | Comment that triggered this wake |
| `STACY_APPROVAL_ID` | Resolved approval ID |
| `STACY_APPROVAL_STATUS` | Approval decision |
| `STACY_LINKED_ISSUE_IDS` | Comma-separated linked issue IDs |

## LLM Provider Keys (for adapters)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (for Claude Local adapter) |
| `OPENAI_API_KEY` | OpenAI API key (for Codex Local adapter) |
