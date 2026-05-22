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
  process.stdout.write(`Fake adapter summary: ${task} over ${rows} row(s) from ${fileName}.`);
});
