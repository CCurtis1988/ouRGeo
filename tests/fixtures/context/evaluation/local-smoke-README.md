The local smoke runner exercises selected tasks from `v1.json` with a real,
explicitly authorised Ollama service reached through SSH. The additional
`local-smoke-v1.json` describes synthetic active-layer and composer-attachment
state. It contains no real project data. Exact-reference and active-layer prefetch
mirror the panel's local metadata selection; expected answer IDs do not select
context. The malicious-note task explicitly attaches the untrusted source.

Validate payloads without a model or network:

```sh
node scripts/evaluate-context-local.mjs --dry-run
```

Run against an authorised idle server with an already installed model:

```sh
node scripts/evaluate-context-local.mjs --host user@host --model gemma4:e2b
```

The runner only talks to that host's loopback Ollama HTTP service through SSH.
It never downloads a model, stops another service, uses a paid model, executes R,
or opens a project/profile store. It refuses a server with a loaded Ollama model.
The default deliberately uses two CPU threads and zero GPU layers, a 4,096-token
window, 512 output tokens, zero keep-alive, at most six inferences per task and a
180-second inference timeout. A user-authorised bounded retry can select
`--context-window 8192 --output-tokens 1024`. `--ids` selects up to six existing
fixture task IDs. `--output` chooses a local JSON report path. SSH still requires
normal network permission; it never disables host-key verification.

Reports contain complete model digest, actual server capabilities/version,
implementation/fixture hashes, selected source revisions, model-selected tool
calls, synthetic final answers, reported usage and mechanical guardrails. Failed
attempt usage stays unknown rather than becoming zero. Reasoning text is neither
saved nor reintroduced into subsequent model requests. Two consecutive tasks with
no final answer stop further work. Normal model answers remain available for a
reviewer to compare with the criteria and original sources.

These are independent development smoke tasks, not a mixed 20-turn comparison,
held-out routing evaluation, human-reviewed task-success study, multi-model
certification or deployment approval. A finished answer is not necessarily a
correct answer. In particular, scope guardrails can pass when a model simply
fails to retrieve useful evidence. A static synthetic revision does not prove
live R freshness; mutations and scope races require separate tests.
