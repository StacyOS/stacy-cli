import { readFile, writeFile } from "node:fs/promises";

import {
  addContact,
  listContacts,
  readContact,
  resolveContactsPath,
} from "../src/contacts/contact-store.js";
import {
  createSignedContactCard,
  parseSignedContactCard,
  verifySignedContactCard,
} from "../src/contacts/contact-card.js";
import { ensureInstallIdentity } from "../src/identity/install-identity.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface ContactsAddOptions extends LocalRuntimeOptions {
  readonly installId: string;
  readonly endpoint: string;
  readonly revocationUrl: string;
  readonly label?: string;
  readonly json?: boolean;
}

export interface ContactsListOptions extends LocalRuntimeOptions {
  readonly json?: boolean;
}

export interface ContactsShowOptions extends LocalRuntimeOptions {
  readonly json?: boolean;
}

export interface ContactsExportOptions extends LocalRuntimeOptions {
  readonly endpoint: string;
  readonly revocationUrl: string;
  readonly label?: string;
  readonly out?: string;
  readonly json?: boolean;
}

export interface ContactsImportOptions extends LocalRuntimeOptions {
  readonly as?: string;
  readonly json?: boolean;
}

export interface ContactsDependencies extends LocalRuntimeDependencies {
  readonly stdout?: Pick<typeof console, "log">;
  readonly now?: () => Date;
}

export async function contactsAddCommand(
  name: string,
  options: ContactsAddOptions,
  dependencies: ContactsDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const contact = await addContact(resolveContactsPath(runtime.instanceRoot), {
    name,
    label: options.label ?? name,
    installId: options.installId.trim(),
    federationEndpointUrl: options.endpoint.trim(),
    revocationUrl: options.revocationUrl.trim(),
  });

  stdout.log(options.json ? JSON.stringify(contact, null, 2) : formatContact(contact));
}

export async function contactsListCommand(
  options: ContactsListOptions,
  dependencies: ContactsDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const contacts = await listContacts(resolveContactsPath(runtime.instanceRoot));
  if (options.json) {
    stdout.log(JSON.stringify({ contacts }, null, 2));
    return;
  }
  stdout.log(contacts.length === 0 ? "No federation contacts." : contacts.map(formatContact).join("\n\n"));
}

export async function contactsShowCommand(
  name: string,
  options: ContactsShowOptions,
  dependencies: ContactsDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const contact = await readContact(resolveContactsPath(runtime.instanceRoot), name);
  if (!contact) {
    throw new Error(`Unknown federation contact: ${name}`);
  }
  stdout.log(options.json ? JSON.stringify(contact, null, 2) : formatContact(contact));
}

export async function contactsExportCommand(
  name: string,
  options: ContactsExportOptions,
  dependencies: ContactsDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const identity = await ensureInstallIdentity({
    path: runtime.identityPath,
    now: dependencies.now?.(),
  });
  const card = createSignedContactCard({
    identity,
    name,
    label: options.label,
    federationEndpointUrl: options.endpoint,
    revocationUrl: options.revocationUrl,
    createdAt: dependencies.now?.(),
  });
  const serialized = `${JSON.stringify(card, null, 2)}\n`;
  if (options.out?.trim()) {
    await writeFile(options.out.trim(), serialized, { mode: 0o600 });
  }
  stdout.log(options.json || !options.out?.trim() ? serialized.trim() : `Wrote signed contact card: ${options.out.trim()}`);
}

export async function contactsImportCommand(
  path: string,
  options: ContactsImportOptions,
  dependencies: ContactsDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const card = parseSignedContactCard(await readFile(path, "utf8"));
  const verification = verifySignedContactCard(card);
  if (!verification.ok) {
    throw new Error(verification.reason);
  }
  const imported = await addContact(resolveContactsPath(runtime.instanceRoot), {
    ...verification.contact,
    ...(options.as?.trim() ? { name: options.as.trim() } : {}),
  });
  stdout.log(options.json ? JSON.stringify(imported, null, 2) : formatContact(imported));
}

function formatContact(contact: {
  readonly name: string;
  readonly label: string;
  readonly installId: string;
  readonly federationEndpointUrl: string;
  readonly revocationUrl: string;
}): string {
  return [
    `Contact: ${contact.name} (${contact.label})`,
    `Install: ${contact.installId}`,
    `Endpoint: ${contact.federationEndpointUrl}`,
    `Revocations: ${contact.revocationUrl}`,
  ].join("\n");
}
