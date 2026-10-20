# Assistant thinking controls — 1.16.31

- Type checking passed.
- Lint: zero errors; 36 existing warnings.
- Full test suite: 2,937 tests across 301 suites passed.
- Production build passed.
- Native Linux acceptance passed against the final build:
  `.cache/ai-thinking-ui/run-VFZaG0/report.json`.

`node scripts/check-ai-thinking.mjs` uses a disposable marked profile and a
synthetic loopback Ollama server. External HTTP requests are blocked; it never
uses a personal account, credentials or paid inference. It verifies advertised
named effort levels and the default label, boolean On/Off controls, hiding
unsupported models, retaining values when changing models, disabling the
selector while streaming, `think: "high"` on the production request, and
persistence after restarting the app. Three screenshots were captured and
visually reviewed. There were no renderer exceptions.

Unit/transport tests additionally cover OpenAI Chat Completions and subscription
Responses payloads, Claude adaptive effort and signed thinking preservation,
Claude Code effort arguments, Gemini named levels and zero/token budgets,
Gemini thought signatures, output headroom, provider default omission,
truncated-tool refusal, independent provider/model preferences, save failure
recovery and conditional UI. Provider calls use deterministic fixtures; live
cloud model reasoning quality and account-specific limits are not measured.

Windows/macOS native verification remains deferred until hardware is available.
