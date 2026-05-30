# Concept: AI Runs

An **AI run** takes one or more Knowledge Objects as context, calls an adapter
(by default Anthropic's Claude), and produces a **new signed Knowledge Object**
of kind `agent_output`. Runs are how ingested data turns into useful, verifiable
output without breaking the provenance chain.

```bash
stacy run "Create a release risk report" \
  --use ko_github_pr_231 \
  --use ko_github_pr_232 \
  --ack-egress \
  --model claude-sonnet-4-5
```

## The pipeline

`stacy run` (`packages/federation/verbs/run.ts`) executes a fixed sequence:

1. **Resolve the adapter** (`--adapter`, else `STACY_DEFAULT_ADAPTER`, else
   `anthropic`).
2. **Egress gate.** If the adapter is non-deterministic and `--ack-egress` was
   not passed, the command errors *before any KO is read or any network call is
   made*.
3. **Load and verify every input KO.** Each `--use <ko_id>` is read and
   re-verified (signature + content hash). A missing or tampered input fails the
   run with a clear error before the model is called.
4. **Call the adapter** with `{ task, model, inputs[] }`.
5. **Validate and wrap** the adapter output in the canonical `agent_output`
   envelope.
6. **Sign a new KO** whose `provenance.inputKoIds` lists the exact inputs.
7. **Append a `run` receipt** (adapter, model, input ids, output hash) alongside
   the `create` and `sign` receipts emitted by the local Brain write.

## The `agent_output` Knowledge Object

```jsonc
{
  "kind": "agent_output",
  "schemaVersion": 1,
  "task": "Create a release risk report",
  "model": "claude-sonnet-4-5",
  "adapter": "anthropic",
  "generatedAt": "2026-05-22T00:00:00.000Z",
  "provenance": {
    "inputKoIds": ["ko_github_pr_231", "ko_github_pr_232"],
    "inputs": [
      { "koId": "ko_github_pr_231", "contentHash": "sha256:…", "contentType": "application/json" }
    ]
  },
  "output": { /* adapter result */ },
  "notes": ["…"]
}
```

Because provenance records the input content hashes, anyone can later confirm a
run was produced from exactly those inputs.

## Adapters

An adapter implements:

```typescript
interface RunAdapter {
  readonly id: string;
  readonly deterministic: boolean; // deterministic adapters never egress
  run(request: AdapterRunRequest): Promise<AdapterRunResult>;
}
```

Shipping in v0.2:

- **`anthropic`** (default) — wraps an external adapter command (for example the
  proven `claude-cli-adapter.mjs`) configured via
  `STACY_ANTHROPIC_ADAPTER_COMMAND`. Non-deterministic, so it requires
  `--ack-egress`.
- **`deterministic`** — produces a templated synthesis of the inputs with no
  network and no egress acknowledgement. Used for tests, demos, and air-gapped
  runs.

Future adapters (`openai`, `gemini`, `local-llama`) are out of scope for v0.2.

## Why the egress gate matters

Input KOs may contain private data. A non-deterministic adapter sends that
content to an external model, so StacyOS refuses to proceed without an explicit
`--ack-egress`. The gate is checked first — before any KO is read — so a
forgotten flag never leaks data and never starts a billable call. The
deterministic adapter, which stays entirely on the install, needs no
acknowledgement.

See the [v0.2 quickstart](../v0.2-connectors-and-runs-quickstart.md) for the
end-to-end flow.
