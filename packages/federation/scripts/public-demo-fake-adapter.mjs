let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const parsed = JSON.parse(input);
  const outputKind = String(parsed.outputKind ?? "dashboard");
  if (outputKind === "referral_packet") {
    process.stdout.write(JSON.stringify({
      title: "Northstar Clinic Referral Packet",
      patientReference: "N.P.",
      referralReason: "Second opinion after abnormal ECG",
      clinicalSummary: "Patient N.P. has intermittent chest tightness, abnormal ECG findings, and elevated cardiac-risk markers.",
      labSnapshot: "LDL 162 mg/dL; hs-CRP 4.8 mg/L; troponin negative",
      medications: ["Atorvastatin 20mg", "aspirin 81mg pending specialist review"],
      imagingStatus: "ECG attached; echocardiogram scheduled",
      consent: {
        expiresAt: "2026-06-22T23:59:59Z",
        revocationReason: "Patient withdrew consent",
      },
      attachments: [
        { label: "ECG", status: "attached" },
        { label: "Echocardiogram", status: "scheduled" },
      ],
      notes: ["Adapter output validated against the referral_packet JSON contract."],
    }));
    return;
  }
  const task = String(parsed.task ?? "");
  const rows = Number(parsed.input?.rows ?? 0);
  const fileName = String(parsed.input?.fileName ?? "input.csv");
  process.stdout.write(JSON.stringify({
    title: "Internal Metrics Dashboard",
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
