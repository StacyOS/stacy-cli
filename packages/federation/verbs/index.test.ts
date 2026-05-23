import { describe, expect, it } from "vitest";
import { federationCliCommands, registerFederationCommands } from "./index.js";

class FakeCommand {
  readonly children: FakeCommand[] = [];
  descriptionText = "";
  actionHandler: ((...args: unknown[]) => unknown) | null = null;

  constructor(readonly nameAndArgs: string) {}

  command(nameAndArgs: string): FakeCommand {
    const child = new FakeCommand(nameAndArgs);
    this.children.push(child);
    return child;
  }

  description(text: string): FakeCommand {
    this.descriptionText = text;
    return this;
  }

  argument(): FakeCommand {
    return this;
  }

  option(): FakeCommand {
    return this;
  }

  requiredOption(): FakeCommand {
    return this;
  }

  action(handler: (...args: unknown[]) => unknown): FakeCommand {
    this.actionHandler = handler;
    return this;
  }
}

describe("federation CLI registration", () => {
  it("registers federation command groups and public demo subcommands", () => {
    const program = new FakeCommand("stacy");

    registerFederationCommands(program);

    const topLevelCommands = program.children.map((child) => child.nameAndArgs);
    expect(topLevelCommands).toContain(federationCliCommands.brain);
    expect(topLevelCommands).toContain(federationCliCommands.share);
    expect(topLevelCommands).toContain(federationCliCommands.revoke);
    expect(topLevelCommands).toContain("contacts");
    expect(topLevelCommands).toContain("receipts");

    const brain = program.children.find((child) => child.nameAndArgs === federationCliCommands.brain);
    expect(brain?.children.map((child) => child.nameAndArgs)).toContain(federationCliCommands.brainCreate);
    expect(brain?.children.map((child) => child.nameAndArgs)).toContain(federationCliCommands.brainDerive);
    expect(brain?.children.map((child) => child.nameAndArgs)).toContain(federationCliCommands.brainShow);
    expect(brain?.children.map((child) => child.nameAndArgs)).toContain(federationCliCommands.brainVerify);

    const contacts = program.children.find((child) => child.nameAndArgs === "contacts");
    expect(contacts?.children.map((child) => child.nameAndArgs)).toEqual(
      expect.arrayContaining(["add", "list", "show", "export", "import"]),
    );

    const receipts = program.children.find((child) => child.nameAndArgs === "receipts");
    expect(receipts?.children.map((child) => child.nameAndArgs)).toEqual(expect.arrayContaining(["list", "verify"]));
  });

  it("wires brain show to the Phase 2 implementation", async () => {
    const program = new FakeCommand("stacy");
    const shown: string[] = [];

    registerFederationCommands(program, {
      brainShow: {
        createDb: () => ({ execute: async () => [] }),
        readKnowledgeObject: async ({ koId }) => {
          shown.push(koId);
          return { ok: false, reason: "expected test stop" };
        },
        stdout: { log: () => undefined },
      },
    });

    const brain = program.children.find((child) => child.nameAndArgs === federationCliCommands.brain);
    const show = brain?.children.find((child) => child.nameAndArgs === federationCliCommands.brainShow);

    await expect(show?.actionHandler?.("ko_123", { dbUrl: "postgres://example" })).rejects.toThrow(
      "expected test stop",
    );
    expect(shown).toEqual(["ko_123"]);
  });

  it("wires revoke to the Phase 4 implementation", async () => {
    const program = new FakeCommand("stacy");
    const revoked: Array<{ readonly koId: string; readonly reason: string }> = [];

    registerFederationCommands(program, {
      revoke: {
        createDb: () => ({ execute: async () => [] }),
        stdout: { log: () => undefined },
      },
    });

    const revoke = program.children.find((child) => child.nameAndArgs === federationCliCommands.revoke);
    await expect(
      revoke?.actionHandler?.("ko_123", { reason: "expected test stop", dbUrl: "postgres://example" }),
    ).rejects.toThrow("Knowledge Object not found");
    revoked.push({ koId: "ko_123", reason: "expected test stop" });
    expect(revoked).toEqual([{ koId: "ko_123", reason: "expected test stop" }]);
  });
});
