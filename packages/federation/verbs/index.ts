import { brainCreateCommand, type BrainCreateDependencies } from "./brain-create.js";
import { brainShowCommand, type BrainShowDependencies } from "./brain-show.js";
import { revokeCommand, type RevokeDependencies } from "./revoke.js";
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
  brainShow: "show",
  share: "share",
  revoke: "revoke",
} as const;

export interface RegisterFederationCommandsOptions {
  readonly brainCreate?: BrainCreateDependencies;
  readonly brainShow?: BrainShowDependencies;
  readonly share?: ShareDependencies;
  readonly revoke?: RevokeDependencies;
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

  program
    .command(federationCliCommands.share)
    .description("Federate a signed Knowledge Object with per-object consent")
    .argument("<ko_id>", "Knowledge Object ID or content hash")
    .requiredOption("--with <install>", "Consumer install ID")
    .option("--to <url>", "Consumer /api/federation endpoint URL")
    .option("--revocation-url <url>", "Producer revocation lookup URL for consumer next-read checks")
    .option("--scope <scope>", "Consent scope", "read")
    .option("--expires <duration>", "Consent expiry duration", "30d")
    .option("--revocable", "Mark the consent grant revocable", false)
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (koId, commandOptions) => {
      await shareCommand(String(koId), commandOptions as Parameters<typeof shareCommand>[1], options.share);
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

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}
