# Linked project folders

Implementation specification supplementing [Project Files](project-files-spec.md).
The owner has authorised both linking an existing folder and creating a new
physical folder from the assistant. Forgetting a link must preserve the folder
and every file on disk. Native Linux verification belongs to the implementing
agent; Windows and macOS verification remains deferred until machines exist.

## Product decision

Keep embedded references and add linked folders as first-class sources in the
same Project Files pane. Embedded references remain useful for portable reports,
standards and examples. Linked folders serve large or frequently updated local
assets whose bytes should remain in place. Both use the existing catalogue,
source controls, selective context broker, message attachments and citations.

The distinction must be visible: saving an embedded file preserves its original
inside `.ourgeoproj`; saving a linked folder preserves a reference and catalogue
metadata. It does not snapshot external file bytes. Project Files must show
whether an item is embedded or linked and whether its current content is usable.

This supplements the archive design instead of replacing it. It avoids inflating
project saves with large working collections while keeping selected reference
documents portable. External files can change independently, so freshness and
honest unavailable states are essential to this feature's value.

## User experience

Keep Project Files in the Console/Terminal tab group by default and preserve the
user's existing panel placement. Add these operations alongside Add files:

- **Link folder…** chooses an existing physical folder and adds its reference.
- **Create linked folder…** chooses an existing parent, creates one new directory
  and links it. Existing directories are not overwritten.
- **Rescan** refreshes the selected linked folder or locally linked collection.
- **Relink…** reconnects a portable, moved or unavailable reference on this device.
- **Rename** changes the project label; it does not rename the physical directory.
- **Forget link** removes this project's reference and indexed access. The physical
  directory and its contents remain intact.

Folder rows show their label, local location when authorised, scan state, last
scan time and bounded coverage/omission information. File rows retain names,
descriptions, roles, sizes, processing status and preview controls. A linked
file's location is relative to its root, with its storage type explicit.

The interface must distinguish:

| State | Meaning and recovery |
| --- | --- |
| Ready | A local grant and successful scan are available; individual reads still validate freshness. |
| Unlinked | The reference has no grant on this device. Choose Relink. |
| Missing | Its previously granted directory is unavailable. Restore the mount or Relink. |
| Needs scan | Contents or identity changed. Rescan before using current evidence. |
| Scanning | Refresh is in progress. Previous indexed bodies cannot establish current contents. |
| Error | The attempted scan failed. Show the cause and offer Retry/Relink. |

A partial or limited scan must report omissions. Ready never means every file
has been interpreted. Large, unsupported, password-protected and failed files
retain their individual coverage limitations. Display metadata-only files without
claiming the assistant has read them.

Removing a staged chat attachment does not forget its folder or delete a file.
Forgetting a folder immediately revokes its library evidence. Reopening a copied
or transferred project must not silently reconnect a local path from bundle data.

## Storage and local authority

Use the existing project-file IDs and source namespace:
`project-file:<projectId>:<fileId>`. A linked entry adds:

```ts
storage: {
  kind: 'linked'
  folderId: string
  relativePath: string
  fingerprint: string
}
```

The catalogue adds `linkedFolders`, with folder ID, label, state, optional local
path, scan time, issue and omission/limit information. Absolute root paths and
local read grants belong to protected device-local state, not portable authority.
The portable representation carries folder identity/label and supported relative
file metadata; another device starts without a read grant.

Projects using links carry manifest version 3, `projectFiles.version: 2` and the
required capability `linked-folders`, with portable library version 2. Older
readers must refuse unsupported capabilities before rewriting the archive.

An empty linked-file `sha256` denotes metadata-only coverage, such as an original
above the assistant's processing budget. It is not the digest of empty bytes and
must not be treated as a readable indexed revision. A fingerprint supports local
change detection; it is not proof that the model received file contents.

Linked originals must not enter the embedded blob directory or archive save
stream. Rebuilding local indexes must not mutate external files. Scanner caches
are recoverable derived data and remain subject to existing protected storage,
exclusion and project-scope rules.

Directory creation creates exactly the requested new child under a validated
existing parent. Main owns path canonicalisation, symlink/traversal checks and
grant storage. No recursive deletion API is added for linked originals. If linking
the new directory fails after creation, preserve the directory and report the
outcome rather than removing possible user-created contents.

## Scanning, large files and freshness

Scanning is local and bounded. Reuse existing extraction formats and budgets for
supported text, PDF, DOCX, workbook and delimited-text evidence; index only changed
files when safely possible. Very large or unsupported files stay on disk and
remain discoverable through metadata. Linking a folder does not make arbitrary
binary data readable by the language model or install new format dependencies.

The initial implementation permits 32 links and 2,000 catalogue entries globally.
A scan visits at most 10,000 nodes, 512 directories, depth 20 and 15 seconds, with
512 MiB of eligible bytes hashed per scan. Reaching a bound marks the result
limited and reports omissions. Originals above the existing 100 MiB per-file
read budget remain discoverable metadata-only entries. SQLite/database formats
remain stored assets without an added document parser.

Respect scanner exclusions and explicit root boundaries. Do not follow symlinks
out of the chosen root or recover excluded content through another indexed path.
Report skipped files and reached limits instead of claiming a complete catalogue.
Directory metadata discovery must not read every file body into model context.

Every body read, content-search excerpt, image rendition and export validates the
current local grant, root, file identity/fingerprint and applicable revision. Main
must detect disappearance or external changes before returning old indexed bytes
as current. A changed source requires Rescan. A remembered catalogue or portable
path is never sufficient filesystem authority.

The renderer omits unavailable linked files from assistant file actions and
context-source availability while their parent is not Ready. Folder recovery
metadata remains available through `project:folders`. Ready metadata-only entries
remain ordinary searchable source descriptors, with a clear limitation. They
must not produce full-text content hits or typed images; body reads return an
actionable budget/coverage refusal.

Revocation invalidates cached handles and retained provider transcripts. Stop an
active response when it actually selected affected evidence. An unrelated folder
scan should not cancel an otherwise unrelated conversation. Recheck availability
after asynchronous work and immediately before provider dispatch.

## Assistant actions

Use the existing project action group and permission settings. No separate
approval system is introduced. Native pickers remain human controls; assistant
creation/linking/relinking requires explicit absolute paths in action arguments.

| Action | Default tier | Behaviour |
| --- | --- | --- |
| `project:folders` | Always | Paginated authorised folder metadata and recovery state. |
| `project:linkFolder` | Confirmation | Link an existing explicit absolute path. |
| `project:createFolder` | Confirmation | Create one new child under an explicit parent and link it. |
| `project:relinkFolder` | Confirmation | Connect an existing folder reference to an explicit local path. |
| `project:forgetFolder` | Confirmation | Forget the reference and indexed access; keep all physical contents. |
| `project:rescanFolders` | Autopilot | Scan selected local references or all locally linked references. |
| `project:renameFolder` | Autopilot | Change the project label only. |

`project:files` includes linked storage information and a readable/metadata-only
distinction. Existing show/update/remove/reindex file actions must honour linked
folder availability and source exclusions. Per-file removal must not become an
external filesystem deletion. Normal R and terminal operations retain their
existing permissions; linking is not a new broad write capability.

The assistant must use actual folder metadata when helping with paths, explain
Unlinked/Missing/Needs scan states, and avoid claiming knowledge of unavailable
contents. Use the existing exact-location citations for supported evidence.
Changing external bytes must not redirect an earlier citation to their new
version. A user requesting quantitative analysis of a large linked dataset uses
the existing visible R workflow; metadata-only discovery is not data analysis.

## Verification and acceptance

The implementing agent owns the checks, including real Linux application checks.
Do not request outside testing or ask the owner to repeat checks the agent can
perform. Record native Windows/macOS checks as deferred.

1. Link an existing self-authored folder through the pane; verify originals stay
   in place and do not appear as archived blob payloads after save/reopen.
2. Create a new physical child through the user control and validated AI action;
   verify its exact parent/name, existing-directory refusal and saved reference.
3. Exercise every AI action through argument validation before its handler.
   Check tiers, absolute-path requirements, current-project ownership and absence
   of model-controlled native pickers.
4. Save and transfer the bundle into a fresh profile. References remain visible
   as Unlinked; no absolute path grants or cached bodies become readable.
5. Rescan after adding, changing and removing files. Verify fresh metadata and
   selective reads; stale references and historical citations remain honest.
6. Mark a root Missing/Needs scan/Scanning/Unlinked and verify its previous
   descriptors, content hits and in-flight evidence are unavailable.
7. Discover a large metadata-only asset through ordinary `context_search` and
   `project:files`. Verify body/image refusal, no content hit from old caches and
   an actionable explanation of the read limit.
8. Exclude a linked file and verify all assistant discovery/read paths respect
   the exclusion, including existing file actions and relinked roots.
9. Forget a link and verify the physical folder and every original remain
   byte-for-byte intact. Save/reopen must retain the forgotten-reference state.
10. Run typecheck, lint, relevant unit/regression checks and native UI acceptance.
    Preserve the existing core prompt budget and disclose actual parser coverage,
    model delivery/comprehension evidence and platform limitations separately.

This specification records intended behaviour. Release evidence belongs in the
implementation/delivery record and must distinguish completed checks from
unverified capabilities.
