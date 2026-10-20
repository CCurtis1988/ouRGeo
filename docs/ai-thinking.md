# Assistant thinking controls

The assistant footer shows **Thinking** when the selected provider/model has
qualified controls. Select a level before sending a message; **Provider default**
leaves the choice to the service. Choices are remembered separately for each
provider/model on this device and survive restarting ouRGeo. An API connection
and a subscription remain separate even when their model names match.

Higher effort can take longer and use more tokens. This is the requested setting,
not a measurement of the model’s internal work; the provider can adapt or limit
it. Changes apply to new messages and their tool follow-ups. The control is
unavailable while a reply is running. A save failure keeps the previous setting
and explains how to retry.

**Context** separately controls evidence retrieval. Thinking settings apply to
assistant turns; independent document and image analysis settings are unchanged.
No extra model connection or registration is required.

## Provider support

- OpenAI API and ChatGPT plan: recognised reasoning models expose their own
  supported levels. For example, o3 offers Low/Medium/High, while newer supported
  models may also offer Off, Minimal, Extra high or Maximum. Unknown models and
  non-reasoning models such as GPT-4o have no control.
- Anthropic API: supported effort-capable Claude models expose their documented
  levels. Adaptive thinking is enabled for supported models when effort is set.
  Opus 4.5 uses its effort parameter without adaptive thinking. Older models
  that only support manual extended-thinking budgets are not given an effort dial.
- Claude Code subscription: supported models and Opus/Sonnet aliases use the
  CLI’s effort flag. The installed CLI and plan policies govern availability
  and any caps; aliases can resolve to different models over time.
- Gemini: qualified level-capable models use named levels. Gemini 2.5 shows
  **Thinking budget** with 1,024, 4,096 or 8,192 tokens. Flash/Flash-Lite also
  allow Off; Pro cannot turn thinking off. Provider default preserves dynamic
  thinking on Pro/Flash and the service’s default on other models.
- Native Ollama: the configured server supplies exact supported values and the
  default through `/api/show`. Model-defined names and boolean On/Off controls
  are supported. Older servers that advertise thinking capability use the
  known gpt-oss levels or boolean controls. If discovery fails or no capability
  is advertised, the selector stays hidden and default behaviour is preserved.
- Other compatible local endpoints: hidden until their reasoning configuration
  can be reliably qualified. An OpenAI-compatible HTTP interface alone is not
  evidence that its model supports OpenAI’s effort parameters.

Hosted thinking shares output limits with the answer. Explicit effort reserves
additional output space within the context window (up to 32,768 tokens and a
quarter of the window). Token budgets are allowances, not a promise of tokens
used. Truncated Claude/OpenAI replies show an actionable error rather than
executing incomplete tool arguments. Private reasoning is not displayed.

## Implementation and verification

Capability rules: `src/lib/ai-thinking.ts`. Device preferences:
`ai-thinking.json` in the application data directory. Missing preferences use
provider defaults; obsolete values are ignored unless offered by the model.

Tests verify provider-specific request fields, signed thinking in tool loops,
Gemini thought signatures, default omission, output reservations, per-model
persistence, failed-save recovery and conditional UI. Native Linux verification
uses `node scripts/check-ai-thinking.mjs` with a disposable profile and a loopback
model fixture. This checks request routing/settings without paid inference;
it does not measure the quality of reasoning. Windows/macOS native checks remain
deferred until hardware is available.

Parameter references checked during implementation:

- [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning)
- [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Claude Code effort](https://code.claude.com/docs/en/model-config#effort-level)
- [Gemini Generate Content thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
- [Ollama thinking metadata](https://docs.ollama.com/capabilities/thinking)
