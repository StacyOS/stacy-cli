import type { CanonicalJsonValue } from "../crypto/canonical.js";

/**
 * Static description of an external-tool connector. Pure data so it can be
 * listed (`stacy connectors list`) without instantiating live auth state.
 */
export interface ConnectorDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly authType: "oauth" | "api-key";
  readonly scopes: readonly string[];
  /** Knowledge Object content kinds this connector can produce. */
  readonly objectKinds: readonly string[];
}

/** A stored, possibly-refreshable credential for one connector + install. */
export interface TokenBundle {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenType?: string;
  readonly scopes: readonly string[];
  /** Human-facing account label, e.g. a GitHub username. */
  readonly account?: string;
  readonly obtainedAt: string;
  readonly expiresAt?: string;
}

/** Surfaced to the CLI so it can render the device-code instructions. */
export interface DeviceAuthorizationPrompt {
  readonly verificationUri: string;
  readonly userCode: string;
  readonly expiresInSeconds: number;
}

export interface AuthenticateOptions {
  /** Restrict to a single organization where the connector supports it. */
  readonly org?: string;
  readonly scope?: string;
  readonly signal?: AbortSignal;
  /** Invoked once the device code is known so the CLI can print it. */
  readonly onUserPrompt?: (prompt: DeviceAuthorizationPrompt) => void;
}

export interface IngestOptions {
  readonly token: TokenBundle;
  /** Connector-specific ingestion parameters (repo, filters, since, …). */
  readonly params: Record<string, unknown>;
  readonly signal?: AbortSignal;
}

/** Provenance the connector attaches to every object it emits. */
export interface ConnectorProvenance {
  readonly connectorId: string;
  readonly connectorVersion: string;
  readonly sourceId: string;
  readonly sourceUrl?: string;
  readonly sourceTimestamp?: string;
  readonly ingestCommand?: string;
}

/** A connector-normalized object, ready to become a signed Knowledge Object. */
export interface NormalizedObject {
  readonly kind: string;
  readonly contentType: string;
  readonly content: CanonicalJsonValue;
  readonly provenance: ConnectorProvenance;
}

export interface StatusReport {
  readonly connected: boolean;
  readonly account?: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: string;
}

/** The behavior every connector implements on top of its descriptor. */
export interface Connector extends ConnectorDescriptor {
  authenticate(opts: AuthenticateOptions): Promise<TokenBundle>;
  refresh(token: TokenBundle): Promise<TokenBundle>;
  ingest(opts: IngestOptions): AsyncIterable<NormalizedObject>;
  status(token: TokenBundle): Promise<StatusReport>;
}
