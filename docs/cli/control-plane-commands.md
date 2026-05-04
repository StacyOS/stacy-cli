---
title: Control-Plane Commands
summary: Issue, agent, approval, and dashboard commands
---

Client-side commands for managing issues, agents, approvals, and more.

## Issue Commands

```sh
# List issues
pnpm stacy issue list [--status todo,in_progress] [--assignee-agent-id <id>] [--match text]

# Get issue details
pnpm stacy issue get <issue-id-or-identifier>

# Create issue
pnpm stacy issue create --title "..." [--description "..."] [--status todo] [--priority high]

# Update issue
pnpm stacy issue update <issue-id> [--status in_progress] [--comment "..."]

# Add comment
pnpm stacy issue comment <issue-id> --body "..." [--reopen]

# Checkout task
pnpm stacy issue checkout <issue-id> --agent-id <agent-id>

# Release task
pnpm stacy issue release <issue-id>
```

## Company Commands

```sh
pnpm stacy company list
pnpm stacy company get <company-id>

# Export to portable folder package (writes manifest + markdown files)
pnpm stacy company export <company-id> --out ./exports/acme --include company,agents

# Preview import (no writes)
pnpm stacy company import \
  <owner>/<repo>/<path> \
  --target existing \
  --company-id <company-id> \
  --ref main \
  --collision rename \
  --dry-run

# Apply import
pnpm stacy company import \
  ./exports/acme \
  --target new \
  --new-company-name "Acme Imported" \
  --include company,agents
```

## Agent Commands

```sh
pnpm stacy agent list
pnpm stacy agent get <agent-id>
```

## Approval Commands

```sh
# List approvals
pnpm stacy approval list [--status pending]

# Get approval
pnpm stacy approval get <approval-id>

# Create approval
pnpm stacy approval create --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]

# Approve
pnpm stacy approval approve <approval-id> [--decision-note "..."]

# Reject
pnpm stacy approval reject <approval-id> [--decision-note "..."]

# Request revision
pnpm stacy approval request-revision <approval-id> [--decision-note "..."]

# Resubmit
pnpm stacy approval resubmit <approval-id> [--payload '{"..."}']

# Comment
pnpm stacy approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm stacy activity list [--agent-id <id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard

```sh
pnpm stacy dashboard get
```

## Heartbeat

```sh
pnpm stacy heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100]
```
