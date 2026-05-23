export const federationPackageName = "@arpanstacy/stacy-federation";

export interface FederationInstallDescriptor {
  readonly name: string;
  readonly tenant: "stacy/acme";
  readonly homeDir: string;
  readonly instanceId: string;
  readonly instanceRoot: string;
  readonly dataDir: string;
  readonly configPath: string;
  readonly envPath: string;
  readonly storageDir: string;
  readonly logDir: string;
  readonly backupDir: string;
  readonly secretsKeyPath: string;
  readonly serverPort: number;
  readonly dbPort: number;
}

export {
  CanonicalizationError,
  canonicalBytes,
  canonicalize,
  type CanonicalJsonValue,
} from "./crypto/canonical.js";
export {
  INSTALL_IDENTITY_SCHEMA_VERSION,
  createInstallIdentity,
  ensureInstallIdentity,
  loadInstallIdentity,
  parseInstallIdentity,
  type EnsureInstallIdentityOptions,
  type InstallIdentity,
  type InstallIdentityRecord,
} from "./identity/install-identity.js";
export { resolveFederationIdentityPath } from "./identity/paths.js";
export {
  KEY_TRANSITION_SCHEMA_VERSION,
  createKeyTransition,
  deriveInstallIdFromPublicKey,
  hashKeyTransitionPayload,
  verifyKeyTransition,
  verifyKeyTransitionChain,
  type CreateKeyTransitionOptions,
  type KeyTransitionChainVerificationResult,
  type KeyTransitionSigner,
  type KeyTransitionUnsignedPayload,
  type KeyTransitionVerificationResult,
  type SignedKeyTransition,
} from "./identity/key-transition.js";
export {
  ensureKeyTransitionTables,
  listKeyTransitions,
  storeKeyTransition,
  type ListKeyTransitionsOptions,
  type StoreKeyTransitionOptions,
} from "./identity/key-transition-store.js";
export {
  addContact,
  listContacts,
  normalizeContactName,
  readContact,
  readContactBook,
  resolveContactsPath,
  writeContactBook,
  type ContactBook,
  type FederationContact,
} from "./contacts/contact-store.js";
export {
  CONTACT_CARD_SCHEMA_VERSION,
  DEFAULT_FEDERATION_TENANT,
  createSignedContactShareLink,
  createSignedContactCard,
  parseSignedContactCard,
  parseSignedContactShareLink,
  verifyContactShareLink,
  verifySignedContactCard,
  type ContactCardPayload,
  type ContactCardVerificationResult,
  type ContactShareLinkPayload,
  type SignedContactCard,
  type SignedContactShareLink,
} from "./contacts/contact-card.js";
export {
  parseAdapterOutput,
  parseAdapterDashboardOutput,
  parseAdapterReportOutput,
  parseAdapterTableOutput,
  type AdapterOutputKind,
  type AdapterDashboardOutput,
  type AdapterReportOutput,
  type AdapterReportSection,
  type AdapterTableOutput,
  type AdapterTableRow,
} from "./dashboard/adapter-output.js";
export {
  createDeterministicDashboardContent,
  createDeterministicReportContent,
  createDeterministicTableContent,
  parseDashboardSchema,
  parseCsv,
  parseCsvDashboardInput,
  type DashboardContent,
  type DashboardInput,
  type DashboardSchema,
  type DashboardSchemaWidget,
  type DashboardWidget,
  type ReferralPacketContent,
  type ReportContent,
  type ReportSection,
  type TableContent,
} from "./dashboard/dashboard-content.js";
export {
  KNOWLEDGE_OBJECT_SCHEMA_VERSION,
  createKnowledgeObject,
  verifyKnowledgeObject,
  type CreateKnowledgeObjectOptions,
  type KnowledgeObjectSignedPayload,
  type KnowledgeObjectUnsignedPayload,
  type KnowledgeObjectVerificationResult,
  type SignedKnowledgeObject,
} from "./ko/knowledge-object.js";
export {
  CONSENT_GRANT_SCHEMA_VERSION,
  CONSENT_GRANT_SCOPE_ADMIN,
  CONSENT_GRANT_SCOPE_READ,
  CONSENT_GRANT_SCOPE_WRITE,
  CONSENT_GRANT_SCOPES,
  consentGrantScopeIncludesRead,
  consentGrantScopeIncludesWrite,
  createConsentGrant,
  isConsentGrantScope,
  verifyConsentGrant,
  type ConsentGrantScope,
  type ConsentGrantRecipient,
  type ConsentGrantSignedPayload,
  type ConsentGrantUnsignedPayload,
  type ConsentGrantVerificationResult,
  type CreateConsentGrantOptions,
  type SignedConsentGrant,
} from "./consent/grant.js";
export {
  enforceReadConsent,
  enforceWriteConsent,
  type EnforceReadConsentOptions,
  type ReadConsentEnforcementResult,
  type WriteConsentEnforcementResult,
} from "./consent/enforcement.js";
export {
  DELEGATION_GRANT_SCHEMA_VERSION,
  MAX_DELEGATION_DEPTH,
  createDelegationGrant,
  enforceDelegationChainDepth,
  enforceDelegationGrant,
  verifyDelegationGrant,
  type CreateDelegationGrantOptions,
  type DelegationEnforcementResult,
  type DelegationGrantSignedPayload,
  type DelegationGrantUnsignedPayload,
  type DelegationGrantVerificationResult,
  type SignedDelegationGrant,
} from "./consent/delegation.js";
export {
  GROUP_ROSTER_SCHEMA_VERSION,
  createGroupRoster,
  groupRosterIncludesInstall,
  normalizeGroupId,
  verifyGroupRoster,
  type CreateGroupRosterOptions,
  type GroupRosterMember,
  type GroupRosterSignedPayload,
  type GroupRosterUnsignedPayload,
  type GroupRosterVerificationResult,
  type SignedGroupRoster,
} from "./consent/group-roster.js";
export {
  ensureGroupRosterTables,
  readGroupRoster,
  storeGroupRoster,
  type ReadGroupRosterOptions,
  type StoreGroupRosterOptions,
} from "./consent/group-roster-store.js";
export {
  REVOCATION_TOMBSTONE_SCHEMA_VERSION,
  createRevocationTombstone,
  verifyRevocationTombstone,
  type CreateRevocationTombstoneOptions,
  type RevocationTombstoneSignedPayload,
  type RevocationTombstoneUnsignedPayload,
  type RevocationTombstoneVerificationResult,
  type SignedRevocationTombstone,
} from "./consent/revocation.js";
export {
  WITNESS_REVOCATION_SCHEMA_VERSION,
  createWitnessedRevocation,
  enforceWitnessRevocationPolicy,
  hashWitnessedRevocationPayload,
  verifyWitnessedRevocation,
  witnessIdFromPublicKey,
  type CreateWitnessedRevocationOptions,
  type SignedWitnessedRevocation,
  type WitnessIdentity,
  type WitnessPolicyEnforcementResult,
  type WitnessRevocationPolicy,
  type WitnessedRevocationUnsignedPayload,
  type WitnessedRevocationVerificationResult,
} from "./consent/witnessed-revocation.js";
export {
  ensureWitnessedRevocationTables,
  listWitnessedRevocations,
  storeWitnessedRevocation,
  type ListWitnessedRevocationsOptions,
  type StoreWitnessedRevocationOptions,
} from "./consent/witnessed-revocation-store.js";
export {
  ensureRevocationTombstoneTables,
  readRevocationTombstone,
  storeRevocationTombstone,
  type ReadRevocationTombstoneOptions,
  type StoreRevocationTombstoneOptions,
} from "./consent/revocation-store.js";
export {
  ensureConsentGrantTables,
  listConsentGrantsForKo,
  readConsentGrant,
  storeConsentGrant,
  type ListConsentGrantsForKoOptions,
  type ReadConsentGrantOptions,
  type StoreConsentGrantOptions,
} from "./consent/grant-store.js";
export {
  ensureBrainTables,
  readKnowledgeObject,
  storeKnowledgeObject,
  type BrainDb,
  type BrainKnowledgeObjectSource,
  type QueryResult,
  type ReadKnowledgeObjectOptions,
  type ReadKnowledgeObjectResult,
  type StoreKnowledgeObjectOptions,
  type StoredKnowledgeObjectProvenance,
} from "./brain/brain-store.js";
export {
  createLocalKnowledgeObject,
  type CreateLocalKnowledgeObjectOptions,
  type CreateLocalKnowledgeObjectResult,
} from "./brain/local-brain.js";
export {
  DERIVED_KO_CONTENT_SCHEMA_VERSION,
  DERIVED_KO_CONTENT_TYPE,
  createDerivedKnowledgeObject,
  type CreateDerivedKnowledgeObjectOptions,
  type CreateDerivedKnowledgeObjectResult,
  type DerivedKnowledgeObjectContent,
} from "./brain/derived-brain.js";
export {
  createVerificationKnowledgeObject,
  type CreateVerificationKnowledgeObjectOptions,
  type CreateVerificationKnowledgeObjectResult,
} from "./brain/verification-brain.js";
export {
  VERIFICATION_REPORT_CONTENT_TYPE,
  VERIFICATION_REPORT_SCHEMA_VERSION,
  createVerificationReportContent,
  type CreateVerificationReportOptions,
  type VerificationCheck,
  type VerificationCheckStatus,
  type VerificationReportContent,
  type VerificationVerdict,
} from "./verification/verification-report.js";
export {
  CONTENT_CONTRACT_COMPATIBILITY,
  validateKnowledgeContentContract,
  type ContentContractKind,
  type ContentContractValidation,
} from "./verification/content-contract.js";
export {
  readKnowledgeObjectWithConsent,
  type ReadKnowledgeObjectWithConsentOptions,
} from "./brain/read-with-consent.js";
export {
  FEDERATION_MESSAGE_SCHEMA_VERSION,
  FEDERATION_MESSAGE_REPLAY_WINDOW_MS,
  createMemoryFederationReplayGuard,
  createFederationMessage,
  receiveFederationMessage,
  verifyFederationMessageSignature,
  type CreateFederationMessageOptions,
  type FederationReplayGuard,
  type FederationKnowledgeObjectMessage,
  type FederationKnowledgeObjectMessageSignedPayload,
  type ReceiveFederationMessageOptions,
} from "./sync/federation-message.js";
export {
  claimReceivedNonce,
  ensureReceivedNonceTables,
  type ClaimReceivedNonceOptions,
} from "./sync/received-nonce-store.js";
export {
  lookupRevocationHttp,
  syncRevocationFromProducer,
  type LookupRevocationHttpOptions,
  type LookupRevocationHttpResult,
  type SyncRevocationFromProducerOptions,
} from "./sync/revocation-lookup.js";
export {
  assertFederationTransportUrl,
  isLoopbackHostname,
  type FederationTransportPurpose,
} from "./sync/transport-policy.js";
export {
  ensureRevocationSourceTables,
  readRevocationSource,
  storeRevocationSource,
  type ReadRevocationSourceOptions,
  type StoreRevocationSourceOptions,
  type StoredRevocationSource,
} from "./sync/revocation-source-store.js";
export {
  receiveFederationHttpMessage,
  type ReceiveFederationHttpOptions,
  type ReceiveFederationHttpResult,
} from "./sync/federation-receive.js";
export {
  appendReceipt,
  ensureReceiptTables,
  hashReceipt,
  hashReceiptAnchor,
  listReceipts,
  verifyGlobalReceiptAnchor,
  verifyReceiptChain,
  type AppendReceiptOptions,
  type FederationReceipt,
  type FederationReceiptAnchor,
  type FederationReceiptEventType,
  type ListReceiptsOptions,
  type VerifyGlobalReceiptAnchorOptions,
  type VerifyGlobalReceiptAnchorResult,
  type VerifyReceiptChainOptions,
  type VerifyReceiptChainResult,
} from "./receipts/receipt-store.js";
