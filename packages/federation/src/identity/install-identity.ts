import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
  verify,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { sha256Hex } from "../util/hash.js";

export const INSTALL_IDENTITY_SCHEMA_VERSION = 1;

export interface InstallIdentityRecord {
  readonly kind: "install_identity";
  readonly schemaVersion: typeof INSTALL_IDENTITY_SCHEMA_VERSION;
  readonly installId: string;
  readonly personId: string;
  readonly workerId: string;
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
  readonly createdAt: string;
}

export interface InstallIdentity {
  readonly record: InstallIdentityRecord;
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
}

export interface EnsureInstallIdentityOptions {
  readonly path: string;
  readonly now?: Date;
}

export async function ensureInstallIdentity(
  options: EnsureInstallIdentityOptions,
): Promise<InstallIdentity> {
  try {
    return parseInstallIdentity(await readFile(options.path, "utf8"));
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const identity = createInstallIdentity(options.now ?? new Date());
  await mkdir(dirname(options.path), { recursive: true });
  await writeFile(options.path, `${JSON.stringify(identity.record, null, 2)}\n`, {
    mode: 0o600,
  });

  return identity;
}

export async function loadInstallIdentity(path: string): Promise<InstallIdentity> {
  return parseInstallIdentity(await readFile(path, "utf8"));
}

export function createInstallIdentity(now: Date = new Date()): InstallIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const fingerprint = sha256Hex(publicKeyPem).slice(0, 32);
  const installId = `install_${fingerprint}`;

  return {
    record: {
      kind: "install_identity",
      schemaVersion: INSTALL_IDENTITY_SCHEMA_VERSION,
      installId,
      personId: `person_${fingerprint.slice(0, 16)}`,
      workerId: `worker_${fingerprint.slice(16, 32)}`,
      publicKeyPem,
      privateKeyPem,
      createdAt: now.toISOString(),
    },
    publicKey,
    privateKey,
  };
}

export function parseInstallIdentity(serialized: string): InstallIdentity {
  const record = JSON.parse(serialized) as InstallIdentityRecord;

  if (record.kind !== "install_identity") {
    throw new Error("Install identity has the wrong kind");
  }

  if (record.schemaVersion !== INSTALL_IDENTITY_SCHEMA_VERSION) {
    throw new Error(`Unsupported install identity schema version ${record.schemaVersion}`);
  }

  const publicKey = createPublicKey(record.publicKeyPem);
  const privateKey = createPrivateKey(record.privateKeyPem);
  const expectedInstallId = `install_${sha256Hex(record.publicKeyPem).slice(0, 32)}`;

  if (record.installId !== expectedInstallId) {
    throw new Error("Install identity id does not match the public key");
  }

  assertMatchingKeypair(publicKey, privateKey);

  return { record, publicKey, privateKey };
}

function assertMatchingKeypair(publicKey: KeyObject, privateKey: KeyObject): void {
  const probe = Buffer.from("stacy-federation-install-identity-probe", "utf8");
  const signature = sign(null, probe, privateKey);

  if (!verify(null, probe, publicKey, signature)) {
    throw new Error("Install identity private key does not match the public key");
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
