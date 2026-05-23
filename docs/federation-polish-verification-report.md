# Federation Polish Final Verification Report

Verified the five requested concerns on `federation-demo-polish-final`, reconstructed the branch into reviewable per-item commits, and confirmed the post-split code diff matched the pre-split combined commit byte-for-byte before adding this verification report. Four concerns are cleanly verified; two honest follow-ups remain: the A2 cached adapter fixture is scenario-specific but not a provable real Claude/Codex capture, and screenshot `06-check-tooltip.png` does not visibly show a tooltip bubble. Final gates passed after reconstruction: `pnpm install`, `demo:check`, `demo:public`, `demo:public:adapter-cached`, and 3x `demo:public:repeat` with slowest repeat `23.16s`.

## V1 - A2 Fixture Verdict

First 30 lines of `packages/federation/test/fixtures/adapter-runs/referral-packet-claude.json`:

```json
{
  "title": "Northstar Clinic Referral Packet",
  "patientReference": "N.P.",
  "referralReason": "Second opinion after abnormal ECG",
  "clinicalSummary": "Patient N.P. reports intermittent chest tightness with elevated LDL and family history of coronary artery disease. Northstar Clinic is requesting specialist review before changing the current care plan.",
  "labSnapshot": "LDL 162 mg/dL; hs-CRP 4.8 mg/L; troponin negative",
  "medications": [
    "Atorvastatin 20mg",
    "aspirin 81mg pending specialist review"
  ],
  "imagingStatus": "ECG attached; echocardiogram scheduled",
  "consent": {
    "expiresAt": "2026-06-22T23:59:59Z",
    "revocationReason": "Patient withdrew consent"
  },
  "attachments": [
    {
      "label": "ECG",
      "status": "attached"
    },
    {
      "label": "Echocardiogram",
      "status": "scheduled"
    }
  ],
  "notes": [
    "LLM-authored referral narrative validated against the referral_packet JSON contract.",
    "Synthetic demo data only; no real protected health information."
  ]
}
```

Classification: **mixed / stub-like**.

Justification: the fixture is scenario-specific and plausible, but it includes static demo wording and no capture metadata proving it came from a real Claude/Codex run. A2 ships the seam structure correctly but the fixture content needs a real capture before the demo is video-ready.

## V2 - C7 Runtime Evidence

The OpenAPI client was run against a live local install seeded with `ko_referral_packet`.

Command:

```bash
pnpm exec tsx example.ts ko_referral_packet http://127.0.0.1:42402 install_4a36a62fe564eafa73341b3b335421b4
```

Stdout:

```json
{
  "status": "allowed",
  "id": "ko_referral_packet",
  "tenant": "stacy/acme",
  "contentType": "application/json",
  "contentHash": "sha256:c53b7d417de393a15e5e3bb815489fdf83b79c1ad29d463fb6d023c8f1e9672f",
  "creatorInstallId": "install_713e1b23276e0079aa85655c2ca838d0",
  "signerInstallId": "install_713e1b23276e0079aa85655c2ca838d0",
  "identities": {
    "producer": {
      "label": "Northstar Clinic",
      "installId": "install_713e1b23276e0079aa85655c2ca838d0",
      "shortInstallId": "install_713e1b...a838d0",
      "verified": true,
      "publicKeyFingerprint": "sha256:713e1b23276e0079"
    },
    "signer": {
      "label": "Northstar Clinic",
      "installId": "install_713e1b23276e0079aa85655c2ca838d0",
      "shortInstallId": "install_713e1b...a838d0",
      "verified": true,
      "publicKeyFingerprint": "sha256:713e1b23276e0079"
    },
    "consumer": {
      "label": "Dr. Meera Patel / Eastside Specialty",
      "installId": "install_4a36a62fe564eafa73341b3b335421b4",
      "shortInstallId": "install_4a36a6...5421b4",
      "verified": true
    }
  },
  "asConsumer": "install_4a36a62fe564eafa73341b3b335421b4",
  "provenance": {
    "source": "federated",
    "storedAt": "2026-05-23T20:42:01.394Z",
    "creatorInstallId": "install_713e1b23276e0079aa85655c2ca838d0",
    "receivedFromInstallId": "install_713e1b23276e0079aa85655c2ca838d0"
  },
  "verification": {
    "signature": "verified",
    "contentHash": "sha256:c53b7d417de393a15e5e3bb815489fdf83b79c1ad29d463fb6d023c8f1e9672f"
  },
  "consent": {
    "status": "enforced",
    "consumerInstallId": "install_4a36a62fe564eafa73341b3b335421b4",
    "grantId": "grant_d33488f38a77ab22a69d7c60c2ff57acf3072482c6aa2f9b8afd67a16205b118",
    "recipient": {
      "id": "install_4a36a62fe564eafa73341b3b335421b4",
      "type": "install"
    }
  },
  "content": {
    "kind": "referral_packet",
    "task": "Northstar Clinic Referral Packet",
    "input": {
      "rows": 1,
      "fileName": "referral-packet.csv",
      "contentHash": "sha256:5df3ac7c8920bf48f7578b3720603efc5fa9089dfc8666f00a58fa9a1854fcd9"
    },
    "title": "Northstar Clinic Referral Packet",
    "consent": {
      "expiresAt": "2026-06-22T23:59:59Z",
      "revocationReason": "Patient withdrew consent"
    },
    "summary": "Northstar Clinic Referral Packet: Second opinion after abnormal ECG for patient N.P..",
    "generator": "deterministic_referral_packet",
    "attachments": [
      {
        "label": "Lab snapshot",
        "status": "LDL 162 mg/dL; hs-CRP 4.8 mg/L; troponin negative"
      },
      {
        "label": "Imaging",
        "status": "ECG attached; echocardiogram scheduled"
      }
    ],
    "generatedAt": "1970-01-01T00:00:00.000Z",
    "labSnapshot": "LDL 162 mg/dL; hs-CRP 4.8 mg/L; troponin negative",
    "medications": [
      "Atorvastatin 20mg",
      "aspirin 81mg pending specialist review"
    ],
    "imagingStatus": "ECG attached; echocardiogram scheduled",
    "schemaVersion": 1,
    "referralReason": "Second opinion after abnormal ECG",
    "clinicalSummary": "Intermittent chest tightness, elevated LDL, family history of coronary artery disease",
    "patientReference": "N.P."
  },
  "receipts": {
    "total": 3,
    "byEvent": {
      "receive": 1,
      "store": 1,
      "read": 1
    }
  },
  "verificationReports": [],
  "receiptVerification": {
    "koChainValid": true,
    "globalAnchorValid": true,
    "checked": {
      "koReceipts": 3,
      "globalAnchors": 5
    }
  }
}
```

Outcome: **pass**. C7 genuinely runs against a live install and returns a parsed enforced KO response.

## V3 - C1 Validator Seam

Relevant diff excerpt from `packages/federation/src/verification/content-contract.ts`:

```diff
+export const CONTENT_CONTRACT_COMPATIBILITY = {
+  dashboard: [1],
+  report: [1],
+  table: [1],
+  referral_packet: [1, 2],
+} as const;
+
+export type ContentContractKind = keyof typeof CONTENT_CONTRACT_COMPATIBILITY;
+export type ContentContractCompatibility = {
+  readonly [Kind in ContentContractKind]: readonly number[];
+};
+
+export function validateKnowledgeContentContract(content: unknown): ContentContractValidation {
+  return validateKnowledgeContentContractWithCompatibility(content, CONTENT_CONTRACT_COMPATIBILITY);
+}
+
+export function validateKnowledgeContentContractWithCompatibility(
+  content: unknown,
+  compatibility: ContentContractCompatibility,
+): ContentContractValidation {
+  if (!isRecord(content)) {
+    return {
+      kind: "unknown",
+      schemaVersion: 0,
+      supportedVersions: [],
+      valid: false,
+      reason: "Knowledge content must be an object.",
+    };
+  }
+  const kind = content.kind;
+  if (!isContentContractKind(kind)) {
+    return {
+      kind: "unknown",
+      schemaVersion: 0,
+      supportedVersions: [],
+      valid: false,
+      reason: `Unsupported content contract kind ${String(kind)}.`,
+    };
+  }
+  const schemaVersion = Number(content.schemaVersion ?? 1);
+  const supportedVersions = compatibility[kind];
+  if (!supportedVersions.includes(schemaVersion as never)) {
+    return {
+      kind,
+      schemaVersion,
+      supportedVersions,
+      valid: false,
+      reason: `Unsupported ${kind} schema version ${schemaVersion}.`,
+    };
+  }
+  return validateByKind(kind, schemaVersion, content, supportedVersions);
+}
```

Categorization:

- `CONTENT_CONTRACT_COMPATIBILITY`: **pure addition / safe**. Static default compatibility matrix; no runtime config or env knob.
- `validateKnowledgeContentContract`: **pure addition / safe default path**. Calls the static matrix directly.
- `validateKnowledgeContentContractWithCompatibility`: **pure addition / test seam**. Lets tests model older/newer reader compatibility without changing production defaults.
- Existing production behavior: **no default-changing addition found**. No env vars, no loose validation flags, and no unsafe production config was added.

Plain-English explanation: the seam separates the production validator from a compatibility-injected validator used by interop tests. Production callers use `validateKnowledgeContentContract`, which always applies the repo-defined compatibility matrix. Tests can call `validateKnowledgeContentContractWithCompatibility` with a narrower matrix to simulate old readers. This is safe because the default path is static and does not allow a deployed install to silently widen accepted schema versions.

Follow-up recommendation: if the package later exposes `content-contract.ts` as public API, consider marking the injected validator as internal/test-only to avoid third-party callers using a custom compatibility matrix accidentally.

## V4 - Push + Metadata

Initial branch push check before reconstruction:

```text
$ git push -u origin federation-demo-polish-final
Everything up-to-date
branch 'federation-demo-polish-final' set up to track 'origin/federation-demo-polish-final'.

$ git ls-remote origin federation-demo-polish-final
caa65044f4bfc6a3d4b07036505b8b3aa3cf77c4	refs/heads/federation-demo-polish-final
```

Diff stat after reconstruction, before this report:

```text
98 files changed, 10195 insertions(+), 174 deletions(-)
```

Skipped/todo test scan:

```text
 ↓ test/harness/real-two-install-smoke.test.ts (4 tests | 4 skipped)
 ↓ test/harness/public-demo-smoke.test.ts (1 test | 1 skipped)
 ↓ src/brain/local-brain.integration.test.ts (4 tests | 4 skipped)
 ↓ test/harness/key-rotation-federation-smoke.test.ts (1 test | 1 skipped)
 Test Files  44 passed | 4 skipped (48)
      Tests  231 passed | 10 skipped (241)
```

Annotations:

- `test/harness/real-two-install-smoke.test.ts`: expected env-gated smoke; enabled by `STACY_FEDERATION_REAL_SERVER_SMOKE=1`.
- `test/harness/public-demo-smoke.test.ts`: expected env-gated smoke; enabled through the public demo scripts.
- `src/brain/local-brain.integration.test.ts`: expected env-gated DB smoke; enabled by `STACY_FEDERATION_REAL_DB_SMOKE=1`.
- `test/harness/key-rotation-federation-smoke.test.ts`: expected env-gated smoke; enabled by `STACY_FEDERATION_REAL_SERVER_SMOKE=1` plus the key-rotation smoke script.
- No `todo` tests surfaced in the filtered output.

## V5 - Screenshot Verification

File metadata:

```text
docs/stacy/stacy-federation-demo-screenshots/05-health-card.png:   PNG image data, 1440 x 1904, 8-bit/color RGB, non-interlaced
docs/stacy/stacy-federation-demo-screenshots/06-check-tooltip.png: PNG image data, 1440 x 1904, 8-bit/color RGB, non-interlaced

docs/stacy/stacy-federation-demo-screenshots/05-health-card.png 214137 bytes modified=May 23 18:28:45 2026
docs/stacy/stacy-federation-demo-screenshots/06-check-tooltip.png 214137 bytes modified=May 23 18:28:45 2026
```

Visual assessment:

- `05-health-card.png`: **real fresh capture**. It shows the Stacy Brain page for `Northstar Clinic Referral Packet` with proof tiles and a visible `Federation health` card containing live-looking values: KOs, receipts, latest receipt timestamp, and roundtrip p50.
- `06-check-tooltip.png`: **fresh capture but insufficient tooltip evidence**. It shows the same page and verification panel with check IDs, but no visible tooltip bubble. This likely happened because the UI uses native/title-style hover text that was not captured in the screenshot. Follow-up: use a rendered tooltip component or retake the screenshot with a visible tooltip bubble.

## R1 - Commit Reconstruction

Post-split code diff matched the saved pre-split combined commit patch before this report was added:

```text
post-split diff matches pre-split diff
```

Reconstructed commits:

- `edc1e6ab` `phase-polish/a2: cached adapter fixture seam` - 6 files changed, 272 insertions, 1 deletion.
- `9b3ca369` `phase-polish/a3-c8: federation health card and check tooltips` - 10 files changed, 1064 insertions, 34 deletions.
- `07937347` `phase-polish/c5: API deprecation headers and policy` - 5 files changed, 633 insertions, 1 deletion.
- `6fca3597` `phase-polish/c4: delegation chain depth limit` - 4 files changed, 711 insertions, 10 deletions.
- `6235e9f1` `phase-polish/c3: group roster churn behavior and tests` - 4 files changed, 524 insertions, 18 deletions.
- `815c374d` `phase-polish/c2: key rotation federation smoke` - 1 file changed, 168 insertions.
- `2236c0f1` `phase-polish/c1: cross-version schema interop smoke` - 4 files changed, 387 insertions.
- `605d0f63` `phase-polish/c6: production demo reseed script` - 2 files changed, 294 insertions.
- `f42da1ef` `phase-polish/c7: OpenAPI TypeScript client example` - 6 files changed, 787 insertions.
- `1f69f945` `phase-polish/leftovers: preserve readiness baseline changes` - 56 files changed, 5355 insertions, 110 deletions. This commit preserves files that were present in the prior combined commit but did not map cleanly to the requested polish-item buckets, including readiness baseline docs, federation route support, and already-claimed Phase 1/2/3 implementation artifacts.

## Final Gate Output

### `CI=true pnpm install`

```text
Scope: all 24 workspace projects
Lockfile is up to date, resolution step is skipped
Packages: +1059
Progress: resolved 1059, reused 1055, downloaded 0, added 1059, done
WARN Failed to create bin at .../packages/stacy-cli/node_modules/.bin/stacy. ENOENT: no such file or directory, open '.../cli/dist/index.js'
WARN Failed to create bin at .../packages/stacy-cli/node_modules/.bin/stacy. ENOENT: no such file or directory, open '.../packages/stacy-cli/node_modules/@arpanstacy/stacy/dist/index.js'
Done in 6s
```

The first non-escalated install failed with DNS `ENOTFOUND` due sandboxed network. The escalated rerun above exited `0`.

### `pnpm --filter @arpanstacy/stacy-federation demo:check`

```text
> @arpanstacy/stacy-federation@0.0.0 demo:check .../packages/federation
> pnpm run preflight && pnpm run typecheck && pnpm run test:acceptance && pnpm run smoke:db && pnpm run smoke:server

Stacy federation demo preflight passed.

> @arpanstacy/stacy-federation@0.0.0 typecheck .../packages/federation
> tsc --noEmit

✓ test/acceptance/federation-demo.acceptance.test.ts (7 tests) 46ms
Test Files  1 passed (1)
Tests  7 passed (7)

✓ src/brain/local-brain.integration.test.ts (4 tests) 9908ms
Test Files  1 passed (1)
Tests  4 passed (4)

✓ test/harness/real-two-install-smoke.test.ts (4 tests) 45639ms
  ✓ starts both isolated Stacy installs and reaches /api/health 10480ms
  ✓ creates on A, federates through B server, and reads on B with consent 11260ms
  ✓ denies B's read through CLI when the delivered grant is expired 11195ms
  ✓ denies B's next read after A revokes without pushing to B 12702ms
Test Files  1 passed (1)
Tests  4 passed (4)
Duration 45.94s
```

Exit code: `0`.

### `pnpm --filter @arpanstacy/stacy-federation demo:public`

```text
StacyOS public federation demo complete
KO: ko_referral_packet
Content hash: sha256:7c08d1c964c3fd9229ac5fe1c06efcf841b48f6f9097b12c459c011f2db8b970
Producer: Northstar Clinic (install_24d3df952e57dee0abb579433435196e)
Consumer: Dr. Meera Patel / Eastside Specialty (install_15499e183d3ed97b6155464404a6a202)
Generator: deterministic_referral_packet
B read before revoke: allowed
A revoked access: Patient withdrew consent
B read after revoke: denied
Receipts A: create, sign, share, revoke
Receipts B: receive, store, read, deny
Receipt chain A: valid
Receipt chain B: valid
Global receipt anchor A: valid
Global receipt anchor B: valid
Total runtime: 19.53s

✓ test/harness/public-demo-smoke.test.ts ... 20498ms
Test Files  1 passed (1)
Tests  1 passed (1)
Duration 20.85s
```

Exit code: `0`.

### `pnpm --filter @arpanstacy/stacy-federation demo:public:adapter-cached`

```text
StacyOS public federation demo complete
KO: ko_referral_packet
Content hash: sha256:3be765fc96f36f2ed4f720e05e88ac0a500f98e7c775d7185b9c9cf30de2e580
Producer: Northstar Clinic (install_cff057f3822b70da718bea24b5db63f1)
Consumer: Dr. Meera Patel / Eastside Specialty (install_2758cc6878ef6cee346edd87b95a370d)
Generator: adapter_command
B read before revoke: allowed
A revoked access: Patient withdrew consent
B read after revoke: denied
Receipts A: create, sign, share, revoke
Receipts B: store, receive, read, deny
Receipt chain A: valid
Receipt chain B: valid
Global receipt anchor A: valid
Global receipt anchor B: valid
Total runtime: 19.54s

✓ test/harness/public-demo-smoke.test.ts ... 20211ms
Test Files  1 passed (1)
Tests  1 passed (1)
Duration 20.59s
```

Exit code: `0`.

### `STACY_FEDERATION_PUBLIC_DEMO_REPEAT=3 pnpm --filter @arpanstacy/stacy-federation demo:public:repeat`

```text
[stacy-federation] public demo run 1/3 passed in 23.16s
[stacy-federation] public demo run 2/3 passed in 21.77s
[stacy-federation] public demo run 3/3 passed in 22.79s
[stacy-federation] repeated public demo passed 3/3 runs.
[stacy-federation] slowest public demo run: 23.16s
```

Exit code: `0`. Slowest repeat run: `23.16s`, under the `60s` cap.

## Concerns Or Follow-Ups

1. **A2 fixture needs a real capture before video-ready.** The cached adapter mechanism works and the gate passes with `Generator: adapter_command`, but the committed fixture is best described as mixed/static rather than a verified real LLM capture.
2. **Tooltip screenshot evidence is incomplete.** `06-check-tooltip.png` is a real/fresh screenshot but does not visibly show the tooltip bubble. The implementation and tests can still be valid, but review evidence should be retaken with a rendered tooltip component or visible hover capture.
3. **`phase-polish/leftovers` is intentionally broad.** It preserves the exact pre-split diff and prevents dropping prior readiness work, but it is not as reviewable as the item-specific commits. Reviewers should treat it as a preservation commit for already-claimed Phase 1/2/3 readiness artifacts.
4. **Install warning remains non-blocking.** `pnpm install` exits `0` but warns that the `stacy` bin cannot be linked before the CLI build artifact exists. This warning existed in the environment and did not block gates.
