import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface FederationContact {
  readonly name: string;
  readonly label: string;
  readonly installId: string;
  readonly federationEndpointUrl: string;
  readonly revocationUrl: string;
}

export interface ContactBook {
  readonly contacts: Record<string, FederationContact>;
}

export function resolveContactsPath(instanceRoot: string): string {
  return resolve(instanceRoot, "federation", "contacts.json");
}

export async function readContactBook(path: string): Promise<ContactBook> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isContactBook(parsed)) {
      throw new Error(`Invalid contacts file at ${path}`);
    }
    return parsed;
  } catch (error) {
    if (isNotFoundError(error)) {
      return { contacts: {} };
    }
    throw error;
  }
}

export async function writeContactBook(path: string, book: ContactBook): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(book, null, 2)}\n`, { mode: 0o600 });
}

export async function addContact(
  path: string,
  contact: FederationContact,
): Promise<FederationContact> {
  const book = await readContactBook(path);
  const normalizedName = normalizeContactName(contact.name);
  const saved = {
    ...contact,
    name: normalizedName,
    label: contact.label.trim() || normalizedName,
  };
  await writeContactBook(path, {
    contacts: {
      ...book.contacts,
      [normalizedName]: saved,
    },
  });
  return saved;
}

export async function listContacts(path: string): Promise<readonly FederationContact[]> {
  const book = await readContactBook(path);
  return Object.values(book.contacts).sort((a, b) => a.name.localeCompare(b.name));
}

export async function readContact(path: string, name: string): Promise<FederationContact | null> {
  const book = await readContactBook(path);
  return book.contacts[normalizeContactName(name)] ?? null;
}

export function normalizeContactName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Contact name is required.");
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) {
    throw new Error("Contact name must use lowercase letters, numbers, dashes, or underscores.");
  }
  return normalized;
}

function isContactBook(value: unknown): value is ContactBook {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const contacts = (value as { contacts?: unknown }).contacts;
  if (typeof contacts !== "object" || contacts === null || Array.isArray(contacts)) return false;
  return Object.values(contacts).every(isContact);
}

function isContact(value: unknown): value is FederationContact {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === "string" &&
    typeof record.label === "string" &&
    typeof record.installId === "string" &&
    typeof record.federationEndpointUrl === "string" &&
    typeof record.revocationUrl === "string"
  );
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
