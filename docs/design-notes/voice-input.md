# Voice input

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

## Voice input (v1.12)

Dictation in the AI panel: a microphone beside Send, a choice of input device,
a ring that shows ouRGeo is hearing you, and a choice of who transcribes it.
`src/lib/voice/`, `src/store/voice.ts`, `electron/main/voice.ts` and
`voice-models.ts`.

Rule 0 does not bind — none of this runs R, so there is no R to echo. Its
corollary does: a recording sent anywhere off this machine is logged to the
console (`describeVoiceCall`), the way `describeWebCall` logs every web tool
call. And rule 22 is why **recorded audio never persists**: clips live in
memory and are dropped after transcription, never in `session.json` or a
`.ourgeoproj`.

**Never exposed:** there are no `voice:*` AI actions. The microphone is the
user's, and an assistant that can arm it belongs on the same list as one that
can close its own panel. The mic button is *pointable* (`ai.voice` in
`targets.ts`) so a tutorial can show where it is; there is nothing that
presses it.

### One capture path

`getUserMedia` → `AudioContext` → an `AudioWorkletNode` whose module is a blob
URL, producing Float32 frames. That one stream feeds the level meter, a WAV
encoder for the services that upload a file, and PCM16 frames for the ones that
stream. MediaRecorder would have given webm/opus, which then needs decoding for
the on-device engine and raises "can this server read opus?" for every local
one; WAV is bigger on the wire and universally understood.

- **The worklet resamples to 16 kHz unconditionally.** Chromium does honour
  `new AudioContext({ sampleRate: 16000 })`, but some Linux ALSA/PulseAudio
  backends have historically been the exception, and a fallback branch that
  only runs on the machines hardest to test on is worse than no branch.
- **CSP**: an `addModule()` request has destination `worker`, so `worker-src
  blob:` covers it — already present. `script-src` is not what governs it.
- **The level never passes through React.** It arrives ~50 times a second; a
  `requestAnimationFrame` loop reads `useVoiceStore.getState().level` and writes
  the transform to the DOM node. A `useVoiceStore((s) => s.level)` anywhere
  re-renders that component fifty times a second for the whole of a dictation.
- `capture.ts` releases the microphone on **every** exit path. A recording
  indicator left burning after the user thinks they have stopped is the worst
  failure available here — it is a privacy failure, and they cannot tell.
- `silence.ts` is a reducer taking `now` as an argument, so its tests need no
  fake clock. Two rules: silence *before* any speech never stops a recording,
  and a mid-sentence breath restarts the window rather than ending the
  dictation.

### The services

`TranscriptionService` (`voice/types.ts`) is data plus one function, like
`ApiProvider`: it is handed a finished clip and returns text, which is what
makes every one of them testable with no audio device. `openStream` is
**optional** — only Deepgram has it, and a batch service never has to pretend.
The registry is shaped like `api-connectors/registry.ts` but is deliberately
not plugin-extensible: nothing asks for a contributed service, and a
registration path with no caller is a guess.

Shipped: the on-device engine (default), an OpenAI-compatible client covering
OpenAI, Groq and every local server that copied the endpoint, then Deepgram,
ElevenLabs Scribe and AssemblyAI. Each spells the same three things
differently — the key header, the model field, the language field — and each
misspelling produces a 400 with nothing useful in it, which is why every
request builder is pure and pinned by a test.

**Multipart does not go through `ai-proxy.ts`.** Its `body` is a string, shaped
for JSON chat bodies streamed back as SSE, and widening a hot path for the one
caller that needs something else is the mistake rule 45 warns about.
`electron/main/voice.ts` builds the form with Node's own `FormData`, and never
sets `Content-Type` by hand — `fetch` computes the boundary, and setting it
manually yields a boundary-less type the server rejects with a puzzling 400.

**Streaming stays in the renderer.** `ws-client.ts` already opens WebSockets
there and the API keys are already renderer-side; a main-process relay would
need a `ws` dependency to protect a secret the renderer is holding anyway. A
browser socket cannot set headers, so Deepgram's key travels as a subprotocol.
The stream is opened *after* capture starts and falls back to the batch path on
any failure, so a service having a bad day costs a few seconds rather than the
dictation.

### The on-device engine

`@huggingface/transformers` is a **devDependency**, and that is not a filing
error. It declares `onnxruntime-node` (296 MB unpacked) and `sharp`, and this
repo ships production `node_modules` inside the asar — `plugins.ts` resolves
`esbuild-wasm/esbuild.wasm` at runtime, which proves it. As a runtime
dependency it would have added ~440 MB to every installer, for every user,
including those who never dictate. Bundled lazily by Vite it costs **23.6 MB**
(`out/` 32.3 → 55.9 MB), almost all of it one 22.5 MB ONNX Runtime wasm.

ORT ships four wasm builds and Vite picked `asyncify` (22.5 MB); the `jspi`
build is 13.9 MB with the same WebGPU support, and Electron 41's Chromium has
JSPI. **Reclaiming those 8.6 MB is an open follow-up** — it needs Vite-level
aliasing of a transitive dependency's static import.

The weights are downloaded on first use, never bundled:

- **Served over a privileged `ourgeo-model://` scheme.** The packaged renderer
  runs from `file://`, where the Cache API does not exist, so transformers.js'
  own caching cannot work and every launch would re-download. Base64 over IPC
  would mean a ~330 MB string for the largest model. `protocol.handle` streams
  from disk instead, and `env.localModelPath` + `allowRemoteModels = false` is
  what makes the offline promise true.
- **Manifests are real, not invented.** Sizes and sha256 come from Hugging
  Face's `x-linked-size` / `x-linked-etag` headers, pinned to a commit rather
  than a branch. Downloads write `.part` and rename only after size and hash
  check, so an interrupted download can never be mistaken for a finished one.
- **Installed-ness is read from disk**, never remembered in a preferences file
  — a flag goes stale the moment someone clears the directory.
- **No cross-origin isolation.** ORT's wasm backend is multi-threaded only
  under COOP/COEP, and enabling COEP globally would gate the `https:` basemap
  tiles and every other cross-origin subresource. So the wasm fallback is
  single-threaded, WebGPU matters more here than on the web, and the model
  picker says so rather than letting someone find out after a 240 MB download.

### Permissions

There was no permission handler at all, so the renderer could have been granted
geolocation, notifications or HID with nothing on screen. Granting `media` came
with an allowlist that refuses everything else. The **check** handler matters as
much as the request handler: it is what `enumerateDevices` consults before
revealing device labels, and without it the microphone picker is a list of
blanks. macOS additionally needs `NSMicrophoneUsageDescription` in
electron-builder's `mac.extendInfo`, and is asked up front so a blocked
microphone is visible before the first click.

**The allowlist is only as good as the list of things the app already did**
(`src/lib/app-permissions.ts`, tested). Written as `permission === 'media'`, it
silently broke **every Copy button in ouRGeo** — the AI chat's code blocks,
both Export Code dialogs, the toolbox, the console's and the terminal's "copy
path", and the terminal's own Ctrl+Shift+C and Ctrl+Shift+V. `navigator.clipboard`
asks the permission **CHECK** handler, never the request handler, so the same
predicate that reveals device labels also decides whether a copy works — and
none of those call sites checked the promise, so each showed a success tick
over an unchanged clipboard. Nothing was on screen to say otherwise, and the
app had shipped that way since 1.12.

- `clipboard-sanitized-write` is granted: writing is an action the user asked
  for and can see the result of, and it cannot read anything.
- `clipboard-read` is **not**, and the difference is the point of having a
  list. It is a standing licence for any renderer code to read whatever the
  user last copied — a password, a token — silently and at any time. The one
  place ouRGeo needs the clipboard's CONTENTS is the terminal's Ctrl+Shift+V,
  which goes through `clipboard:readText`: a main-process read that happens
  once, on the keystroke.
- The predicate lives in its own pure module so it is a list you can read and a
  test can hold you to. `REFUSED_WITH_REASON` records why each refusal is a
  refusal, so nobody grants one back to make a symptom go away.
