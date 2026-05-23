import { brainDeriveCommand, type BrainDeriveDependencies } from "./brain-derive.js";
import { brainCreateCommand, type BrainCreateDependencies } from "./brain-create.js";
import { brainShowCommand, type BrainShowDependencies } from "./brain-show.js";
import { brainVerifyCommand, type BrainVerifyDependencies } from "./brain-verify.js";
import {
  contactsAddCommand,
  contactsExportCommand,
  contactsImportCommand,
  contactsListCommand,
  contactsShowCommand,
  type ContactsDependencies,
} from "./contacts.js";
import { receiptsListCommand, receiptsVerifyCommand, type ReceiptsDependencies } from "./receipts.js";
import { revokeCommand, type RevokeDependencies } from "./revoke.js";
import { runTaskCommand, type RunTaskDependencies } from "./run-task.js";
import { shareCommand, type ShareDependencies } from "./share.js";

interface CommandLike {
  command(nameAndArgs: string): CommandLike;
  description(text: string): CommandLike;
  argument(name: string, description: string): CommandLike;
  option(flags: string, description: string, ...extra: unknown[]): CommandLike;
  requiredOption(flags: string, description: string): CommandLike;
  action(handler: (...args: unknown[]) => unknown): CommandLike;
}

export const federationCliCommands = {
  brain: "brain",
  brainCreate: "create",
  brainDerive: "derive",
  brainShow: "show",
  brainVerify: "verify",
  share: "share",
  revoke: "revoke",
} as const;

export interface RegisterFederationCommandsOptions {
  readonly brainCreate?: BrainCreateDependencies;
  readonly brainDerive?: BrainDeriveDependencies;
  readonly brainShow?: BrainShowDependencies;
  readonly brainVerify?: BrainVerifyDependencies;
  readonly share?: ShareDependencies;
  readonly revoke?: RevokeDependencies;
  readonly contacts?: ContactsDependencies;
  readonly receipts?: ReceiptsDependencies;
  readonly runTask?: RunTaskDependencies;
}

export function registerFederationCommands(
  program: CommandLike,
  options: RegisterFederationCommandsOptions = {},
): void {
  const brain = program
    .command(federationCliCommands.brain)
    .description("StacyOS Brain Knowledge Object operations");

  brain
    .command(federationCliCommands.brainCreate)
    .description("Create and store a local signed Knowledge Object")
    .option("--content-json <json>", "Knowledge Object content as JSON")
    .option("--prompt <text>", "Generate Knowledge Object content from a prompt")
    .option("--adapter-command <command>", "Optional adapter-like command that reads the prompt on stdin and writes output")
    .option("--adapter-arg <arg>", "Argument passed to --adapter-command; repeat for multiple args", collectOption, [])
    .option("--content-type <type>", "Knowledge Object content type", "application/json")
    .option("--ko-id <id>", "Deterministic Knowledge Object ID for harness runs")
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .option("--json", "Print raw JSON output", false)
    .action(async (commandOptions) => {
      await brainCreateCommand(commandOptions as Parameters<typeof brainCreateCommand>[0], options.brainCreate);
    });

  brain
    .command(federationCliCommands.brainShow)
    .description("Show a signed Knowledge Object with provenance")
    .argument("<ko_id>", "Knowledge Object ID or content hash")
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .option("--as-consumer <install_id>", "Enforce federated read consent as this consumer install")
    .option("--json", "Print raw JSON output", false)
    .action(async (koId, commandOptions) => {
      await brainShowCommand(String(koId), commandOptions as Parameters<typeof brainShowCommand>[1], options.brainShow);
    });

  brain
    .command(federationCliCommands.brainDerive)
    .description("Create a consumer-signed derived Knowledge Object from a write-granted federated KO")
    .argument("<source_ko_id>", "Federated source Knowledge Object ID")
    .requiredOption("--content-json <json>", "Derived Knowledge Object content as JSON")
    .option("--content-type <type>", "Derived Knowledge Object content type")
    .option("--ko-id <id>", "Deterministic Knowledge Object ID for harness runs")
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .option("--json", "Print raw JSON output", false)
    .action(async (sourceKoId, commandOptions) => {
      await brainDeriveCommand(
        String(sourceKoId),
        commandOptions as Parameters<typeof brainDeriveCommand>[1],
        options.brainDerive,
      );
    });

  brain
    .command(federationCliCommands.brainVerify)
    .description("Create a signed verification report for a Knowledge Object")
    .argument("<source_ko_id>", "Knowledge Object ID to verify")
    .option("--input <path>", "Original input file used by the Knowledge Object")
    .option("--schema <path>", "Dashboard schema used for deterministic reconciliation")
    .option("--ko-id <id>", "Deterministic verification Knowledge Object ID for harness runs")
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .option("--json", "Print raw JSON output", false)
    .action(async (sourceKoId, commandOptions) => {
      await brainVerifyCommand(
        String(sourceKoId),
        commandOptions as Parameters<typeof brainVerifyCommand>[1],
        options.brainVerify,
      );
    });

  program
    .command(federationCliCommands.share)
    .description("Federate a signed Knowledge Object with per-object consent")
    .argument("<ko_id>", "Knowledge Object ID or content hash")
    .option("--with <install>", "Consumer install ID")
    .option("--with-contact <name>", "Consumer contact name from the federation contacts book")
    .option("--to <url>", "Consumer /api/federation endpoint URL")
    .option("--revocation-url <url>", "Producer revocation lookup URL for consumer next-read checks")
    .option("--scope <scope>", "Consent scope: read or write; admin is reserved", "read")
    .option("--expires <duration>", "Consent expiry duration", "30d")
    .option("--revocable", "Mark the consent grant revocable", false)
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (koId, commandOptions) => {
      await shareCommand(String(koId), commandOptions as Parameters<typeof shareCommand>[1], options.share);
    });

  const contacts = program
    .command("contacts")
    .description("Federation contact address book operations");

  contacts
    .command("add")
    .description("Add or update a federation contact")
    .argument("<name>", "Contact name")
    .requiredOption("--install-id <id>", "Contact install ID")
    .requiredOption("--endpoint <url>", "Contact /api/federation endpoint URL")
    .requiredOption("--revocation-url <url>", "Contact revocation lookup URL")
    .option("--label <text>", "Human-readable label")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (name, commandOptions) => {
      await contactsAddCommand(String(name), commandOptions as Parameters<typeof contactsAddCommand>[1], options.contacts);
    });

  contacts
    .command("list")
    .description("List federation contacts")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (commandOptions) => {
      await contactsListCommand(commandOptions as Parameters<typeof contactsListCommand>[0], options.contacts);
    });

  contacts
    .command("show")
    .description("Show a federation contact")
    .argument("<name>", "Contact name")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (name, commandOptions) => {
      await contactsShowCommand(String(name), commandOptions as Parameters<typeof contactsShowCommand>[1], options.contacts);
    });

  contacts
    .command("export")
    .description("Export this install as a signed federation contact card")
    .argument("<name>", "Contact name recipients should save")
    .requiredOption("--endpoint <url>", "This install's /api/federation endpoint URL")
    .requiredOption("--revocation-url <url>", "This install's revocation lookup URL")
    .option("--label <text>", "Human-readable label")
    .option("--out <path>", "Write the signed contact card to a file")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (name, commandOptions) => {
      await contactsExportCommand(String(name), commandOptions as Parameters<typeof contactsExportCommand>[1], options.contacts);
    });

  contacts
    .command("import")
    .description("Import and verify a signed federation contact card")
    .argument("<path>", "Path to a signed contact card JSON file")
    .option("--as <name>", "Save the contact under a local alias")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (path, commandOptions) => {
      await contactsImportCommand(String(path), commandOptions as Parameters<typeof contactsImportCommand>[1], options.contacts);
    });

  const receipts = program
    .command("receipts")
    .description("Federation receipt log operations");

  receipts
    .command("list")
    .description("List federation receipts")
    .option("--ko <ko_id>", "Filter receipts by Knowledge Object ID")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (commandOptions) => {
      await receiptsListCommand(commandOptions as Parameters<typeof receiptsListCommand>[0], options.receipts);
    });

  receipts
    .command("verify")
    .description("Verify the tamper-evident receipt hash chain")
    .option("--ko <ko_id>", "Filter receipts by Knowledge Object ID")
    .option("--global", "Verify the global instance receipt anchor chain", false)
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (commandOptions) => {
      await receiptsVerifyCommand(commandOptions as Parameters<typeof receiptsVerifyCommand>[0], options.receipts);
    });

  program
    .command(federationCliCommands.revoke)
    .description("Revoke a federated Knowledge Object grant")
    .argument("<ko_id>", "Knowledge Object ID or content hash")
    .requiredOption("--reason <text>", "Revocation reason")
    .option("--grant-id <id>", "Specific consent grant id to revoke")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (koId, commandOptions) => {
      await revokeCommand(String(koId), commandOptions as Parameters<typeof revokeCommand>[1], options.revoke);
    });
}

export { runTaskCommand, type RunTaskDependencies };

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}
