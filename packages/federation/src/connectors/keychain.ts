import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { TokenBundle } from "./types.js";

/**
 * Token storage abstraction. The v0.2 default is an AES-256-GCM encrypted file
 * (see {@link FileKeychain}); an OS-keychain backend can be added later without
 * touching callers.
 */
export interface KeychainStore {
  get(account: string): Promise<TokenBundle | undefined>;
  set(account: string, token: TokenBundle): Promise<void>;
  delete(account: string): Promise<boolean>;
  list(): Promise<readonly string[]>;
}

interface EncryptedEntry {
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string;
}

type EncryptedStoreFile = Record<string, EncryptedEntry>;

export interface FileKeychainOptions {
  /** Path to the encrypted token store JSON file. */
  readonly storePath: string;
  /**
   * Path to the 32-byte encryption key. Created with mode 0600 on first use.
   * Defaults to `<storePath>.key`.
   */
  readonly keyPath?: string;
}

/**
 * Encrypts tokens at rest with AES-256-GCM. The key lives in a sibling file
 * readable only by the owner (mode 0600). This protects tokens against casual
 * disk reads and accidental commits; it is not a substitute for an OS keychain
 * and is documented as such.
 */
export class FileKeychain implements KeychainStore {
  private readonly storePath: string;
  private readonly keyPath: string;

  constructor(options: FileKeychainOptions) {
    this.storePath = options.storePath;
    this.keyPath = options.keyPath ?? `${options.storePath}.key`;
  }

  async get(account: string): Promise<TokenBundle | undefined> {
    const store = await this.readStore();
    const entry = store[account];
    if (!entry) return undefined;
    const key = await this.ensureKey();
    return JSON.parse(decryptEntry(entry, key)) as TokenBundle;
  }

  async set(account: string, token: TokenBundle): Promise<void> {
    const key = await this.ensureKey();
    const store = await this.readStore();
    store[account] = encryptValue(JSON.stringify(token), key);
    await this.writeStore(store);
  }

  async delete(account: string): Promise<boolean> {
    const store = await this.readStore();
    if (!(account in store)) return false;
    delete store[account];
    await this.writeStore(store);
    return true;
  }

  async list(): Promise<readonly string[]> {
    return Object.keys(await this.readStore());
  }

  private async readStore(): Promise<EncryptedStoreFile> {
    try {
      return JSON.parse(await readFile(this.storePath, "utf8")) as EncryptedStoreFile;
    } catch (error) {
      if (isMissingFileError(error)) return {};
      throw error;
    }
  }

  private async writeStore(store: EncryptedStoreFile): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  }

  private async ensureKey(): Promise<Buffer> {
    try {
      const existing = Buffer.from(await readFile(this.keyPath, "utf8"), "base64");
      if (existing.length === 32) return existing;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    const key = randomBytes(32);
    await mkdir(dirname(this.keyPath), { recursive: true });
    await writeFile(this.keyPath, key.toString("base64"), { mode: 0o600 });
    return key;
  }
}

function encryptValue(plaintext: string, key: Buffer): EncryptedEntry {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptEntry(entry: EncryptedEntry, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(entry.iv, "base64"));
  decipher.setAuthTag(Buffer.from(entry.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
