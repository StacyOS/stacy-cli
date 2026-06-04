export const federationCheckDescriptions: Record<string, string> = {
  signed_ko_verified: "The source Knowledge Object signature and content hash verified before this report was created.",
  content_contract: "The KO content is a JSON object with a registered verifier or a clear fallback warning.",
  content_contract_version: "The KO content kind and schema version are supported by this reader.",
  dashboard_contract: "Dashboard content includes a title, summary, and at least one widget.",
  source_input_reconciled: "Stored input metadata matches the source file name, hash, and row count supplied for verification.",
  deterministic_reconciliation: "Dashboard widgets match the deterministic CSV and schema aggregation.",
  report_contract: "Report content includes a title, summary, and at least one section.",
  table_contract: "Table content includes a title, columns, and rows.",
  referral_packet_contract: "Referral packet content includes patient reference, clinical, lab, medication, imaging, and consent fields.",
};

export function describeFederationCheck(checkId: string): string {
  return federationCheckDescriptions[checkId] ?? `Check ID: ${checkId}, no description registered.`;
}
