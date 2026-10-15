# Plugin skills and context source SDK

Available from ouRGeo 1.16.18. The manifest remains version 1; its optional context
contract is separately versioned. Old documentation contributions remain searchable.
Context-only plugins need no dummy action or entry point.

## Declarative resources

```json
{
  "id": "flood-reference",
  "name": "Flood reference",
  "version": "1.0.0",
  "ourgeoVersion": ">=1.16.18",
  "permissions": ["context-source"],
  "context": {
    "version": 1,
    "required": ["sources"],
    "sources": [{
      "id": "terminology",
      "title": "Flood exposure terminology",
      "summary": "Parcel exposure, flood return periods and buffer units",
      "bodyFile": "docs/terminology.md"
    }]
  }
}
```

Keep Markdown inside the plugin. The store package includes declared skill and
source files and refuses missing files. Static source bodies are read on demand;
the loader retains a SHA-256 observation and reads refuse changes until reload.
Source IDs become `document:plugin:<plugin-id>:<local-id>`. The host sets
application scope and untrusted provenance. A source cannot choose a memory bank,
personal scope, trust, tools or permanent injection.

`context.skills` retains its declarative shape: local `id`, `summary`, Markdown
`bodyFile`, `triggers`, `exclusions`, local `actions` and `requiresSources` lists.
It supports at most 100 skills. Skills alone need no context-source permission
and do not grant access to user context. Action prerequisites attach only to
that plugin's own actions, including when a missing skill file blocks guidance.

## Skill dependencies and sections (1.16.19)

From 1.16.19, `dependsOn` names local skills and `ourgeoVersion` declares a
minimum app version; both require `skill-dependencies`. Declare `skill-sections`
for `sections: [{id, summary, bodyFile, required}]`. Each Markdown section is
addressable as `skill:<plugin>:<skill>:<section>`. Required sections and local
dependencies must be delivered at current revisions before their actions run.
Missing files, cycles and stale deliveries block the action. The graph has a
32-resource traversal ceiling and still honours retrieval budgets; use a higher
Context effort for larger workflows. `requiresSources` accepts exact source IDs
or `environment.schema`, `document.current`, `console.execution` categories.
These require already-delivered current authorised evidence, and never grant
permission to read personal resources. Store packages include section files.

## Host-reviewed memory profiles (1.16.19)

```json
{
  "permissions": ["memory-provider"],
  "context": {
    "version": 1,
    "required": ["memory-providers"],
    "providers": [{
      "id": "local-lexical",
      "label": "Local lexical memory",
      "profileId": "mnemosyne-lexical-v1"
    }]
  }
}
```

This references the host's reviewed experimental Linux profile. It does not
register arbitrary executable provider code or certify another deployment.
Unknown profiles appear unavailable. Native registration checks installed
manifest bytes, app compatibility and explicit current permission grants;
legacy enabled flags grant no provider permission. Enabling the plugin sends no
memory. Stage the runtime, then review each scope in AI Assistant → Advanced →
Plugin memory profiles. Imports and migrations remain separate selections.
Disabled, removed or changed descriptors invalidate reviews and pause contributed
bindings, preserving canonical memory and already transmitted copies. Every
dispatch rechecks current eligibility. Updated descriptors need a fresh review.

## Dynamic publication

Add `main`, the separate `context-source` permission and
`context.required: ["dynamic-sources"]`:

```ts
export function activate(ctx) {
  const dispose = ctx.context.publish({
    id: 'result',
    title: 'Flood exposure result',
    summary: 'Synthetic parcel flood exposure result in metres',
    revision: '1',
    read: ({ signal }) => {
      signal.throwIfAborted()
      return 'The plugin’s own result text.'
    },
  })
  // dispose() withdraws this exact publication.
}
```

The callback receives only an AbortSignal. Discovery searches local descriptors;
no user query, conversation, memory or host context is passed to the plugin.
There is no personal-context read API. Network and native-service permissions
remain separate. A plugin may publish at most 64 sources, with local lowercase
IDs, titles up to 120 characters, summaries up to 500 and revisions up to 96
letters, digits, underscores, dots, colons or hyphens.
Reads expire after two seconds and accept at most 100,000 text characters; normal
broker redaction, response/token budgets and exclusions apply afterwards.

Dynamic sources belong to the current workspace. Project changes withdraw them
and abort reads. Publish fresh resources for the new workspace. Republishing
changes the host revision even if the declared revision was reused; old broker
references cannot serve cached evidence. An old disposer cannot remove a newer
publication. Disable, uninstall and reload revoke saved callbacks and handles.
Revocation cannot undo work a callback has already performed; honour its signal.
The deadline rejects late results even if synchronous code delayed its timer.
The soft renderer sandbox cannot pre-empt code that blocks the JavaScript thread;
hostile-code isolation remains separate work.

## Consent and updates

The Plugin Manager displays **Share this plugin’s own context resources with the
AI assistant** separately from network access. A historical enabled flag does not
grant it. Updates adding permissions switch the plugin off until the user reviews
and enables it again. If the manifest changes after the permission list was
displayed, enablement refreshes that list and asks the user to review it again.

Use **Browse current context sources** to inspect or exclude resources. Plugin
guidance remains untrusted, and user-owned memories are independent of plugin
availability. Code plugins still use the existing soft sandbox; a malicious
renderer/native plugin is outside this API's security guarantee.

## Provider contributions and qualification

This source SDK does not register memory providers. The
[provider adapter contract](context-provider-sdk.md) and conformance fixtures
remain separate; certified plugin provider activation is still a stage 4 gate.
Required unsupported capabilities are refused rather than silently ignored.
Semantic retrieval and advanced reasoning remain optional and require measured
benefit before release. Independent corpus review and usability studies remain
deferred by the owner, with requirements retained.

Run `npm run test:context-plugin-sdk` after `npm run build` for the native
synthetic Linux integration checks. The report states its platform and fixture
boundary; it does not certify hostile-code isolation or provider deployments.

## Linux verification

`npm run test:context-plugin-sdk` drives the built Electron app in a guarded
synthetic profile. Add `-- --managed-profile --local-server` to exercise actual
private runtime staging, scoped provider writes, migration, recall, health and
old-copy cleanup. These optional fixtures require the separately downloaded,
SHA-256-pinned archives used by `scripts/spike-context-mnemosyne.mjs`; they never
download packages, use a real account or open the owner's profile.

`npm run test:context-mnemosyne-server` runs real upstream lexical conformance
and a synthetic 512-record lookup comparison. Set `OURGEO_CONTEXT_STRACE_PATH`
to a verified strace executable for the whole-process network observation and
positive control. `docs/context-mnemosyne-local-server-evidence.json` records the
reviewed Linux boundary. Unknown profiles and arbitrary remote deployments
still need a host review; none can self-certify through a plugin manifest.

The Hindsight fixture requires a separate private Python venv with
`hindsight-api-slim[embedded-db]` installed from commit
`5fc4ce20917b916240cef27c212c387a177f115b`. It uses no LLM or learned embedding
model and makes no semantic-quality claim. `npm run test:context-hindsight`
accepts `-- --python /absolute/path/to/venv/bin/python`. Its current strict
plaintext deletion audit intentionally fails; preserve the evidence and keep
personal-memory activation unavailable rather than treating that exit as a pass.
