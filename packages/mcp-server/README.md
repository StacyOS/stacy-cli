# Stacy MCP Server

Model Context Protocol server for Stacy.

This package is a thin MCP wrapper over the existing Stacy REST API. It does
not talk to the database directly and it does not reimplement business logic.

## Authentication

The server reads its configuration from environment variables:

- `STACY_API_URL` - Stacy base URL, for example `http://localhost:3100`
- `STACY_API_KEY` - bearer token used for `/api` requests
- `STACY_COMPANY_ID` - optional default company for company-scoped tools
- `STACY_AGENT_ID` - optional default agent for checkout helpers
- `STACY_RUN_ID` - optional run id forwarded on mutating requests

## Usage

```sh
npx -y @arpanstacy/stacy-mcp-server
```

Or locally in this repo:

```sh
pnpm --filter @arpanstacy/stacy-mcp-server build
node packages/mcp-server/dist/stdio.js
```

## Tool Surface

Read tools:

- `stacyMe`
- `stacyInboxLite`
- `stacyListAgents`
- `stacyGetAgent`
- `stacyListIssues`
- `stacyGetIssue`
- `stacyGetHeartbeatContext`
- `stacyListComments`
- `stacyGetComment`
- `stacyListIssueApprovals`
- `stacyListDocuments`
- `stacyGetDocument`
- `stacyListDocumentRevisions`
- `stacyListProjects`
- `stacyGetProject`
- `stacyGetIssueWorkspaceRuntime`
- `stacyWaitForIssueWorkspaceService`
- `stacyListGoals`
- `stacyGetGoal`
- `stacyListApprovals`
- `stacyGetApproval`
- `stacyGetApprovalIssues`
- `stacyListApprovalComments`

Write tools:

- `stacyCreateIssue`
- `stacyUpdateIssue`
- `stacyCheckoutIssue`
- `stacyReleaseIssue`
- `stacyAddComment`
- `stacySuggestTasks`
- `stacyAskUserQuestions`
- `stacyRequestConfirmation`
- `stacyUpsertIssueDocument`
- `stacyRestoreIssueDocumentRevision`
- `stacyControlIssueWorkspaceServices`
- `stacyCreateApproval`
- `stacyLinkIssueApproval`
- `stacyUnlinkIssueApproval`
- `stacyApprovalDecision`
- `stacyAddApprovalComment`

Escape hatch:

- `stacyApiRequest`

`stacyApiRequest` is limited to paths under `/api` and JSON bodies. It is
meant for endpoints that do not yet have a dedicated MCP tool.
