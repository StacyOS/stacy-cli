let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const parsed = JSON.parse(input);
  const task = String(parsed.task ?? "");
  const rows = Number(parsed.input?.rows ?? 0);
  const fileName = String(parsed.input?.fileName ?? "input.csv");
  process.stdout.write(JSON.stringify({
    title: "Acme Q2 Revenue Dashboard",
    summary: `Fake adapter summary: ${task} over ${rows} row(s) from ${fileName}.`,
    widgets: [
      { kind: "metric", label: "Revenue", value: "$423,750" },
      { kind: "metric", label: "Pipeline", value: "$1,067,500" },
      { kind: "metric", label: "Active customers", value: 53 },
      { kind: "risk", label: "Churn risk", value: 0.07 },
    ],
    notes: ["Adapter output validated against the dashboard JSON contract."],
  }));
});
