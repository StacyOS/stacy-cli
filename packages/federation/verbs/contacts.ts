import {
  addContact,
  listContacts,
  readContact,
  resolveContactsPath,
} from "../src/contacts/contact-store.js";
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

export interface ContactsDependencies extends LocalRuntimeDependencies {
  readonly stdout?: Pick<typeof console, "log">;
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
