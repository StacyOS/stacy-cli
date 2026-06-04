export {
  GitHubConnector,
  parseRepo,
  type GitHubConnectorOptions,
  type GitHubIngestParams,
} from "./connector.js";
export {
  GITHUB_CONNECTOR_ID,
  GITHUB_CONNECTOR_VERSION,
  GITHUB_ISSUE_KIND,
  GITHUB_PULL_REQUEST_KIND,
  normalizeIssue,
  normalizePullRequest,
} from "./normalize.js";
export {
  authenticateWithDeviceFlow,
  GITHUB_API_BASE_URL,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_TOKEN_URL,
  type GitHubOAuthConfig,
} from "./oauth.js";
export { GitHubApi, type GitHubApiOptions } from "./api.js";
