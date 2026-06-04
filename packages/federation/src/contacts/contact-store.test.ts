import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  addContact,
  listContacts,
  normalizeContactName,
  readContact,
  readContactBook,
  resolveContactsPath,
} from "./contact-store.js";

const tempRoots: string[] = [];

describe("federation contact store", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("stores, normalizes, lists, and reads contacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-contacts-"));
    tempRoots.push(root);
    const contactsPath = resolveContactsPath(join(root, "instance"));

    await expect(readContactBook(contactsPath)).resolves.toEqual({ contacts: {} });
    const saved = await addContact(contactsPath, {
      name: "Meera",
      label: "Meera's Stacy install",
      installId: "install_meera",
      federationEndpointUrl: "http://127.0.0.1:3102/api/federation",
      revocationUrl: "http://127.0.0.1:3101/api/federation/revocations",
    });

    expect(saved).toMatchObject({ name: "meera", installId: "install_meera" });
    await expect(readContact(contactsPath, "MEERA")).resolves.toMatchObject({
      name: "meera",
      label: "Meera's Stacy install",
    });
    await expect(listContacts(contactsPath)).resolves.toEqual([
      expect.objectContaining({ name: "meera" }),
    ]);
  });

  it("rejects invalid contact names before writing", () => {
    expect(() => normalizeContactName("")).toThrow("Contact name is required");
    expect(() => normalizeContactName("meera@example")).toThrow("lowercase letters");
  });
});
