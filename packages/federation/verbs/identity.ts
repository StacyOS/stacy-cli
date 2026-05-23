import { createDb } from "@arpanstacy/stacy-db";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { BrainDb } from "../src/brain/brain-store.js";
import {
  createInstallIdentity,
  loadInstallIdentity,
  type InstallIdentity,
} from "../src/identity/install-identity.js";
import {
  createKeyTransition,
  type SignedKeyTransition,
  verifyKeyTransitionChain,
} from "../src/identity/key-transition.js";
import {
  listKeyTransitions,
  storeKeyTransition,
} from "../src/identity/key-transition-store.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface IdentityRotateOptions extends LocalRuntimeOptions {
  readonly reason?: string;
  readonly effectiveAt?: string;
  readonly json?: boolean;
}

export interface IdentityVerifyChainOptions extends LocalRuntimeOptions {
  readonly json?: boolean;
}

export interface IdentityDependencies extends LocalRuntimeDependencies {
  readonly createDb?: (connectionString: string) => BrainDb;
  readonly stdout?: Pick<typeof console, "log">;
  readonly now?: Date;
  readonly createIdentity?: (now?: Date) => InstallIdentity;
  readonly loadIdentity?: (path: string) => Promise<InstallIdentity>;
  readonly storeTransition?: (options: {
    readonly db: BrainDb;
    readonly transition: SignedKeyTransition;
    readonly storedAt?: Date;
  }) => Promise<unknown>;
  readonly listTransitions?: (options: { readonly db: BrainDb }) => Promise<readonly SignedKeyTransition[]>;
  readonly writeIdentityFile?: (path: string, identity: InstallIdentity) => Promise<void>;
  readonly writeBackupFile?: (path: string, identity: InstallIdentity) => Promise<void>;
}

export async function identityRotateCommand(
  options: IdentityRotateOptions,
  dependencies: IdentityDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const now = dependencies.now ?? new Date();
  const effectiveAt = parseOptionalDate(options.effectiveAt, "--effective-at") ?? now;
  const oldIdentity = await (dependencies.loadIdentity ?? loadInstallIdentity)(runtime.identityPath);
  const newIdentity = dependencies.createIdentity?.(now) ?? createInstallIdentity(now);
  const transition = createKeyTransition({
    oldIdentity,
    newIdentity,
    effectiveAt,
    now,
    reason: options.reason,
  });
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);
  const backupPath = resolveIdentityBackupPath(runtime.identityPath, oldIdentity.record.installId);

  try {
    await (dependencies.storeTransition ?? storeKeyTransition)({
      db,
      transition,
      storedAt: now,
    });
    await (dependencies.writeBackupFile ?? writeIdentityBackupFile)(backupPath, oldIdentity);
    await (dependencies.writeIdentityFile ?? writeActiveIdentityFile)(runtime.identityPath, newIdentity);

    const result = {
      transitionId: transition.id,
      oldInstallId: oldIdentity.record.installId,
      newInstallId: newIdentity.record.installId,
      effectiveAt: transition.signedPayload.effectiveAt,
      backupPath,
    };
    stdout.log(options.json ? JSON.stringify(result, null, 2) : formatRotation(result));
  } finally {
    if (ownsDb) await closeDb(db);
  }
}

export async function identityVerifyChainCommand(
  options: IdentityVerifyChainOptions,
  dependencies: IdentityDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);

  try {
    const transitions = await (dependencies.listTransitions ?? listKeyTransitions)({ db });
    const verification = verifyKeyTransitionChain(transitions);
    if (options.json) {
      stdout.log(JSON.stringify({ verification, transitions }, null, 2));
      return;
    }
    if (verification.ok) {
      stdout.log(
        verification.checked === 0
          ? "Install key chain valid. No rotations recorded."
          : [
              `Install key chain valid. Checked ${verification.checked} transition(s).`,
              `Root install: ${verification.rootInstallId}`,
              `Current install: ${verification.currentInstallId}`,
            ].join("\n"),
      );
      return;
    }
    const message = [
      "Install key chain invalid.",
      `Checked before failure: ${verification.checked}`,
      verification.firstInvalidTransitionId ? `First invalid transition: ${verification.firstInvalidTransitionId}` : undefined,
      `Reason: ${verification.reason}`,
    ].filter(Boolean).join("\n");
    stdout.log(message);
    throw new Error(message);
  } finally {
    if (ownsDb) await closeDb(db);
  }
}

function formatRotation(result: {
  readonly transitionId: string;
  readonly oldInstallId: string;
  readonly newInstallId: string;
  readonly effectiveAt: string;
  readonly backupPath: string;
}): string {
  return [
    "Federation install identity rotated.",
    `Transition: ${result.transitionId}`,
    `Old install: ${result.oldInstallId}`,
    `New install: ${result.newInstallId}`,
    `Effective at: ${result.effectiveAt}`,
    `Previous identity backup: ${result.backupPath}`,
  ].join("\n");
}

function parseOptionalDate(value: string | undefined, flag: string): Date | undefined {
  if (!value?.trim()) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${flag} must be a valid ISO date.`);
  }
  return parsed;
}

function resolveIdentityBackupPath(identityPath: string, installId: string): string {
  return join(dirname(identityPath), `federation-install-identity.${installId}.previous.json`);
}

async function writeActiveIdentityFile(path: string, identity: InstallIdentity): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(identity.record, null, 2)}\n`, { mode: 0o600 });
}

async function writeIdentityBackupFile(path: string, identity: InstallIdentity): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(identity.record, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
}

async function closeDb(db: BrainDb): Promise<void> {
  const maybeDb = db as { readonly $client?: { end?: () => Promise<unknown> } };
  await maybeDb.$client?.end?.();
}
