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
  createSignedContactCard,
  parseSignedContactCard,
  verifySignedContactCard,
  type ContactCardPayload,
  type ContactCardVerificationResult,
  type SignedContactCard,
} from "./contacts/contact-card.js";
export {
  createDeterministicDashboardContent,
  parseDashboardSchema,
  parseCsv,
  parseCsvDashboardInput,
  type DashboardContent,
  type DashboardInput,
  type DashboardSchema,
  type DashboardSchemaWidget,
  type DashboardWidget,
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
  CONSENT_GRANT_SCOPE_READ,
  createConsentGrant,
  verifyConsentGrant,
  type ConsentGrantSignedPayload,
  type ConsentGrantUnsignedPayload,
  type ConsentGrantVerificationResult,
  type CreateConsentGrantOptions,
  type SignedConsentGrant,
} from "./consent/grant.js";
export {
  enforceReadConsent,
  type EnforceReadConsentOptions,
  type ReadConsentEnforcementResult,
} from "./consent/enforcement.js";
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
  ensureRevocationTombstoneTables,
  readRevocationTombstone,
  storeRevocationTombstone,
  type ReadRevocationTombstoneOptions,
  type StoreRevocationTombstoneOptions,
} from "./consent/revocation-store.js";
export {
  ensureConsentGrantTables,
  readConsentGrant,
  storeConsentGrant,
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
  readKnowledgeObjectWithConsent,
  type ReadKnowledgeObjectWithConsentOptions,
} from "./brain/read-with-consent.js";
export {
  FEDERATION_MESSAGE_SCHEMA_VERSION,
  createFederationMessage,
  receiveFederationMessage,
  verifyFederationMessageSignature,
  type CreateFederationMessageOptions,
  type FederationKnowledgeObjectMessage,
  type FederationKnowledgeObjectMessageSignedPayload,
  type ReceiveFederationMessageOptions,
} from "./sync/federation-message.js";
export {
  lookupRevocationHttp,
  syncRevocationFromProducer,
  type LookupRevocationHttpOptions,
  type LookupRevocationHttpResult,
  type SyncRevocationFromProducerOptions,
} from "./sync/revocation-lookup.js";
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
  listReceipts,
  verifyReceiptChain,
  type AppendReceiptOptions,
  type FederationReceipt,
  type FederationReceiptEventType,
  type ListReceiptsOptions,
  type VerifyReceiptChainOptions,
  type VerifyReceiptChainResult,
} from "./receipts/receipt-store.js";
