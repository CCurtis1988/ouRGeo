# AI assistant: tools, chats, transport, sending, thinking effort

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

## AI Assistant (`src/lib/ai-*.ts`, `src/components/ai/`)

`ai-client.ts` speaks four transports (Anthropic, OpenAI-compatible, Gemini, Ollama)
behind one `sendMessage(opts)`. Tools are **provider-neutral**: `SendOptions.tools`
is an `AiTool[]` that each transport re-encodes (`anthropicTools` /`openAiTools` /
`geminiTools`), and `onToolCall({ id, name, input })` dispatches by name. Every
transport reads its stream through `readLineStream`, which buffers across chunk
boundaries — a tool's arguments arrive as many small deltas and a JSON event
routinely straddles two reads. Anthropic streams *with* tools (reassembling
`input_json_delta` fragments), so enabling a tool never costs the streaming UX;
Ollama still falls back to non-streaming when tools are attached.

The AI panel footer switches decide which capabilities may be attached; the
context compiler reduces optional schema exposure for small model windows:

| Switch | Tool(s) | Default | Store |
|--------|---------|---------|-------|
| **Autopilot** | `execute_r_code` — runs R in the live session | off | `ai.autoPilotEnabled` |
| **Web** | `web_search`, `web_fetch` (`ai-web-tools.ts`) | **on** | `ai.webAccessEnabled` (persisted in `ai-preferences.json`) |
| *(none)* | `read_document`, `write_document`, `edit_document` (`ai-doc-tools.ts`) | always | — |
| *(per action)* | `list_ui_actions`, `run_ui_action`, `toolbox_tools`, `run_toolbox_tool`, `ourgeo_docs` (`ai-ui-tools.ts`) | attached always; each ACTION is tiered | `ai.actionTiers` (persisted) |

A disabled switch is *absent* from the request rather than declined afterwards, and
`runTool` in `AiChatPanel` re-reads the store at call time so flipping a switch off
mid-answer stops the next call. **Web** controls search/fetch tools; it does not
disable the selected assistant API, local model connection or other configured
application networking. R and Terminal also retain their own permissions.
Every web call is logged to
the console as an `info` entry (`describeWebCall`), so the console stays a complete
record of what the assistant did.

- `web_search` scrapes DuckDuckGo's no-JS HTML endpoint (no API key); `web_fetch`
  reduces HTML to text with `DOMParser`, passes JSON/CSV/text through, refuses
  binaries, and blocks loopback/RFC1918/link-local hosts (those belong in the
  console, where the user can see the request).
- The active small contract is `context/compiler.ts`, with a separate host
  scope/switch card in the user turn. `ai-system-prompt.ts` retains the legacy
  builders for accounting comparisons: `AI_BASE_PROMPT`,
  `buildProvenanceRules()` and `buildToolGuidance({ autoPilot, webAccess })`. The
  provenance rules are the reason the module exists — the assistant must derive
  every figure from a named R object through code the user can re-run: no recalled
  statistics, no hand-typed `data.frame()` behind a chart, every transformation
  shown, and an explicit "I can't" when the data isn't in the session.
  `buildToolGuidance` states the *current* switch positions so the model never
  claims a capability it wasn't given.

### Chats belong to the project (v1.15)

The panel held ONE conversation, in memory only. A renderer reload lost it, and
the only way to ask an unrelated question was the "New" button — which called
`clearMessages()`. So the analysis that produced a map was unfindable an hour
later, and a second question cost you the first exchange.

`AiChat` is now the unit, and `useAiStore` owns a set of them (`chats`,
`activeChatId`) the way the editor owns tabs and the terminal owns shells.
Shaped after `NamedSession` (`store/geometryEdit.ts`) for its selectors and
after `TerminalSession` (`store/terminal.ts`) for two rules worth copying: a
title that follows the content until the user renames it (`renamed`), and a
delete that activates the **neighbour** rather than the first.

- **`selectMessages` returns a module-level `NO_MESSAGES`**, never `?? []`. The
  panel subscribes to it directly, and a selector that BUILDS a value returns a
  new one every call, which zustand reads as a change and re-renders for ever.
  Pinned by a test that asserts reference identity, because the symptom is a
  hung panel rather than a wrong value.
- **Everything per-conversation moved onto the chat** — `messages`,
  `claudeSessionId`, `lastSessionContext`, `tokenUsage` — through
  `patchActiveChat`, lifted from `patchActiveSession`. `isStreaming`,
  `streamingContent` and `abortController` stay top-level: one turn runs at a
  time, and `streamingContent` changes per token, so putting it inside the
  array every switcher row subscribes to would re-render the list for the whole
  of an answer.
- **A chat remembers the provider and model it was held with**, and switching
  restores them — a conversation written by Opus and one written by a local 8B
  are not the same artefact, and the model selector is a global. But
  `switchChat` deliberately does NOT go through `setProvider`/`setModel`: those
  write `ai-preferences.json`, so opening an old chat would silently change
  what the next NEW one starts on and would survive a restart having never been
  asked for. That file keeps its old meaning — the default a new chat begins
  with.
- **Switching while a turn is running stops it first**, which since 1.14.3
  files the partial answer in the chat it belonged to rather than letting the
  next chunk land in the conversation being opened.
- **`deleteChat` never leaves zero.** A panel with no chat has nowhere to put
  the next message, and an empty switcher is a dead end rather than a clean
  slate.

**Where they live** (`lib/ai-chats-persistence.ts`) is one slice with two
homes, the shape `session-persistence.ts` already solves: one
`buildChatsData`/`applyChatsData` pair serves both the `ai-chats.json` autosave
and `manifest.ui.chats`. `ui.chats` is optional so every bundle written before
this opens unchanged, and a conversation is project content now, so
`setupProjectTracking` gained a fifth subscription and the unsaved-changes
prompt covers it.

**Scratch does not keep chats, and that is the point of scratch.** It is the
workspace ouRGeo always launches into, with a clean R session every time and no
Save; a conversation worth keeping is a reason to make a real project out of it,
after which the chats travel with the file. Scratch that quietly accumulated
every conversation the user ever had in it would be a filing cabinet nobody
chose to open. So `ai-chats.json` is **session-scoped** — in
`SESSION_SCOPED_FILES` beside `plots.json` and `console.json` — and `newProject`
restores nothing, leaving the one empty chat `clearWorkspaceStores` made.

Session-scoped is not the same as never written. The file exists so a renderer
reload — Ctrl+R, or the automatic one when the renderer dies — does not cost
the user the conversation they are in the middle of, and so a crash leaves it
for recovery. Every other panel behaves that way; a chat that alone did not
would be the one thing a reload destroyed. Two consequences:

- **There is no flush on quit.** A write started as the window closes races the
  `will-quit` unlink, and the loser is whichever the OS schedules second — so
  an exit could leave scratch's chats on disk for the next launch to read back
  as its own. `workspace-persistence.ts` omits its `beforeunload` flush for
  exactly this reason.
- **`SESSION_SCOPED_FILES` moved into `src/lib/session-scoped-files.ts`**, with
  a test. The list was inline in `index.ts`, and an omission there is silent in
  the way that matters: a file left off it survives a clean exit, and the
  symptom is yesterday's state in a session the user expected to be fresh, with
  nothing on screen to explain it. Same argument as `app-permissions.ts`. The
  test also asserts the preference files are NOT in it, because the opposite
  mistake — a setting that silently reverts — is just as unexplainable.

**A stored Claude Code session can be a cold cache, and that is routine.**
`claudeSessionId` names a transcript on THIS machine; a portable `.ourgeoproj`
opened elsewhere names one that does not exist. Measured against 2.1.263:

```
$ claude --resume <unknown-uuid> …
exit=1   stderr: No conversation found with session ID: …
stdout: {"type":"result","subtype":"error_during_execution",…}
```

Left alone the dead id is what we stored, so every retry fails identically and
the conversation is finished for good. So **ouRGeo's `messages` are the record
and the session id is an optimisation**: `sendClaudeCli` runs the resume, and
on `isMissingSession` replays the whole turn once as a new session carrying the
catch-up block `withEarlierTurns` already builds. The user is told nothing,
because nothing went wrong from where they sit.

One ordering trap, found by the test: the `result` event's `isError` branch
settles the promise *during* the stream, and only `onDone` has the stderr that
distinguishes a cold cache from a real failure. So a resume whose subtype is
`error_during_execution` is deliberately left for `onDone` to classify.

**The assistant reads chats and cannot move between them** (`ai-actions/chat.ts`:
`chat:list`, `chat:read`, both `always`). The rule below still stands — the AI
panel is never exposed, because an assistant that can close its own panel can
end the conversation — and switching or deleting a chat is that hazard one step
worse: it takes the user out of the conversation they are in. Looking carries
none of it, and "what did we decide last week?" is answerable from this project
and nowhere else. `chat:list` says outright that it cannot switch or delete, so
a model spends no turn discovering it and points at the switcher instead.

### The transport (`electron/main/ai-proxy.ts`, `src/lib/ai-fetch-error.ts`)

Two bugs lived here, and both presented as the same four words in the chat
panel: **"Error: fetch failed"**.

- **Remote `net.fetch`; local HTTP uses Node's request API.** Node's global fetch is undici, whose `headersTimeout`
  and `bodyTimeout` are both **five minutes** — a deadline ouRGeo never chose
  and never mentioned. A local model given a large prompt on a busy GPU
  routinely exceeds it, and a request queued behind another waits for the whole
  of that one first. Measured against a server holding its headers for 320 s:
  Node's fetch threw at **300.8 s** with `UND_ERR_HEADERS_TIMEOUT`; Electron's
  `net.fetch` returned the answer. Chromium's stack imposes no such deadline,
  and streaming, custom headers and `AbortSignal` were each verified against a
  local server before the swap rather than assumed. The user can already see a
  slow request and stop it; ouRGeo does not need a timer of its own. Later native
  auditing found Chromium's external IPv6 route probes on literal loopback URLs.
  `local-http.ts` now uses `node:http.request` for loopback HTTP, with literal
  destinations and same-origin local redirects. That API has no fetch-style
  five-minute header/body deadline. Compression, cancellation and severed streams
  are checked separately; cancelling decoded output closes its underlying socket.
  `local-network.ts` intercepts local renderer/R assets before Chromium resolves
  them and bridges the R console through a main-process WebSocket bound to the
  running R port. Remote requests retain Chromium's session behaviour.
- **A dropped stream is an ERROR, not an end.** `proxyFetch`'s `onError` called
  `finish()` once the response had been handed over, which resolves the pending
  read as a clean end-of-stream — so a connection that died mid-sentence was
  indistinguishable from a model that had finished speaking, and the truncated
  text was returned as the complete answer with nothing anywhere saying
  otherwise. A half-answer presented as whole is worse than an error, because
  only the error can be acted on. It now rejects, and the partial text is kept
  (see `finalizeStream`).
- **`describeFetchFailure` names the recovery move.** `fetch` reports a server
  that is not running, a server that never answered, and a connection that
  dropped identically; the cause is one level down in `err.cause` (undici) or
  in a bare `net::ERR_…` string (Chromium), and the host is in the URL. It
  reads both vocabularies, walks the cause chain, and answers with a sentence
  naming the host and what to do — the same argument `transport-retry.ts` makes
  about axios reporting a severed socket as `Network Error`. `isLoopbackHost`
  decides who is being blamed: a local server is a process the user can go and
  look at.
- **An abort settles on the renderer side.** Telling main to abort also removes
  the listeners that would carry its reply back, so a read left waiting on them
  would never settle — an invisible failure: the panel looks idle while the
  turn's promise hangs for ever, and with it the guard that stops a message
  being sent twice.

### Sending a message (`AiChatPanel.handleSend` / `runTurn`)

**The send is claimed synchronously, before the first `await`.** The broker binds
the chat and workspace epoch before relevant retrieval. It uses local metadata
first; unrelated requests do not refresh R or preview objects. R schema reads
are explicit and bounded. Nothing used to say a send was under way until all of it
had finished: the box still held the text, Send was still enabled,
`isStreaming` was still false. A user who clicked again because nothing had
happened sent the message **twice**, and two turns then ran at once against the
same model. `sendingRef` covers the same tick (Enter and a click); `beginStream`
covers every tick after it, and now runs before the preparation rather than
after it. `runTurn` is split out so the ordering rule — claim, commit, then
await — fits on one screen.

**A failed turn keeps what was streamed.** The catch used to call
`finalizeStream(streamingContent)`, closing over the value from the render that
built the callback — which is empty, always, because the turn had not started.
So a transport that died mid-answer finalized an EMPTY message and everything
the user had been reading vanished at the moment the error appeared. It reads
`useAiStore.getState().streamingContent` instead: the same class of bug as
`useGeometryCommit`, and the same fix.

**Stop keeps the half-written answer too.** `cancelStream` used to clear
`streamingContent`, so pressing Stop deleted every word just read — including
the part the user stopped it because they had already got. Stopping means "that
is enough", not "undo that". And `finalizeStream` adds no message when there is
nothing to add, because a blank assistant bubble reads as the assistant having
answered with nothing.

**Every message carries a copy button, on the side its bubble is on** — below
the bubble rather than in a corner of it, because the assistant's own code
blocks already carry one at their top-right and a second in the corner would
sit on top of the first whenever a message opens with code. The row is always
in the layout and only its opacity changes: revealing it on hover would grow
the column at the moment the pointer arrives and nudge every message below it,
and a list that moves under the cursor is one you cannot click accurately. It
copies `message.content` — for the assistant that is the raw MARKDOWN, which is
what pastes usefully into a document and what round-trips; and it is not shown
while streaming, because an unfinished answer is the wrong thing to offer.

`CopyButton` has a `failed` state, and it is not defensive padding: it is what
found the permission bug above. The old version set `copied` before the write
had resolved, so a rejected write showed a tick over an unchanged clipboard and
the user only learned otherwise when they pasted. A copy button that lies is
worse than one that is missing.

**`detectMentionedObjects` reads the user's environments only.** It used to
scan the search path too, so an ordinary English sentence matched
`package:base` and "Reply with one word" asked R for the first five rows of the
`with` FUNCTION. R refuses with a 500, the preview is dropped silently, and
nothing looks wrong — but `base`, `stats` and `utils` are full of words people
write in sentences (`with`, `data`, `table`, `max`, `range`, `format`, `file`,
`date`, `sort`), so a plain question fired several doomed round trips at a
SERIAL R server before it could be sent. That wait is the window in which a
user sees nothing happen and clicks Send again. `!isSearchPath` is the same
predicate the Environment panel uses, and it is right twice over: a package
function has no rows to preview, and a preview is only useful for something the
user put there.

**`tokenUsage.total` starts at 0, meaning "no provider has said yet"**, and the
panel draws against the resolved per-model size until one has. It is reset by a
provider or model switch: the reading describes ONE model's window, so carrying
it across would show the new model's bar filled by the old one's conversation.


### Requested thinking effort (1.16.31)

`ai-thinking.ts` keeps a conservative provider/model capability allowlist; an
OpenAI-compatible endpoint does not qualify a model’s reasoning parameters.
Native Ollama discovers exact values/default from `/api/show`, falling back to
older advertised thinking capability. Discovery is scoped to the connection and
ignores stale replies. Unknown models have no control. `ThinkingEffortControl`
shows only qualified choices, disables while streaming, and remembers each
provider/model pair through the serialised `ai-thinking.json` preference store.
These device preferences do not enter project archives or register new accounts.

`runTurn` freezes the selected setting after initialisation. Context retrieval’s
existing effort setting stays independent. Before compiling evidence it reserves
output room for requested hosted reasoning (up to 32,768 tokens and a quarter of
the context window); a manual Gemini thinking budget also reserves reply space.
Provider default changes neither the payload nor the existing output allowance.
Each transport encodes its own control: Chat Completions `reasoning_effort`,
Responses `reasoning.effort`, Claude `output_config.effort` and adaptive thinking
where supported, Claude Code `--effort`, Gemini `thinkingConfig`, Ollama `think`.
Signed thinking blocks/signatures must be echoed unchanged within tool loops,
never exposed as answer text or persisted as visible chat. Truncated hosted tool
calls are refused before any action is executed.
