import pc from "picocolors";

const STACY_ART = [
  "███████╗████████╗ █████╗  ██████╗██╗   ██╗",
  "██╔════╝╚══██╔══╝██╔══██╗██╔════╝╚██╗ ██╔╝",
  "███████╗   ██║   ███████║██║      ╚████╔╝ ",
  "╚════██║   ██║   ██╔══██║██║       ╚██╔╝  ",
  "███████║   ██║   ██║  ██║╚██████╗   ██║   ",
  "╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝   ╚═╝   ",
] as const;

const TAGLINE = "Trust-first control plane for AI agent work";

export function printStacyCliBanner(): void {
  const lines = [
    "",
    ...STACY_ART.map((line) => pc.cyan(line)),
    pc.blue("  ───────────────────────────────────────────────────────"),
    pc.bold(pc.white(`  ${TAGLINE}`)),
    "",
  ];

  console.log(lines.join("\n"));
}
