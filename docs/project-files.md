# Project Files

Keep reports, standards, figure examples and supporting documents in your ouRGeo
project. **In project** files keep their original bytes inside the `.ourgeoproj`
bundle. **Linked folders** keep working files in a folder on disk and make them
available through the same library. The library also works without an AI account
or an R connection once the project is saved.

## Add and organise files

Open **Project Files** beside **R console** and **Terminal**, or from the project
menu. Drag the pane elsewhere if you prefer; ouRGeo remembers your layout.

Choose **Add files**, or drop files onto the pane. In scratch, **Save project to
add files** first creates a named project. Cancelling that save imports nothing.
Imports copy files; editing the source elsewhere does not change the project copy.

Select a file and open **Preview / details** to edit its display name, logical
folder, description or role. Use **Reference** for supporting evidence,
**Standard** for likely requirements and **Example** for illustrations of the
desired result. Your descriptions survive reindexing. A role helps discovery;
it does not automatically insert the document into every conversation.

Search and filter the list by location, role, logical folder, status or assistant
availability. **All locations** includes embedded files and linked folders;
**In project** shows only embedded originals. Each linked folder has its own
location filter. Logical folders classify files without moving them on disk.
Use **Select multiple**, Ctrl/Command-click or Shift-click for a selection;
arrow keys, Home/End and Enter provide keyboard navigation. Delete opens the
removal review; Escape dismisses a selection or dialog.

**Added · Not saved** means the original is protected by local recovery storage
but has not yet been committed to the portable project. Use the normal project
**Save** action before sharing or moving the bundle. File processing and saving
are separate: a file can be safely stored even when its contents cannot be indexed.

## Linked folders

Choose **Linked folders** in the Project Files header, then either:

- **Link folder…** selects an existing folder through the native folder picker.
- **Create linked folder…** asks for a new folder name, then **Choose parent and
  create folder…** creates a physical directory in the parent location you select
  and links it to the project.

Both workflows require a saved, named project. Cancelling Save As or the folder
picker creates no linked folder. Linked originals remain external: the footer
reports **In project** bytes separately from **Linked** external bytes. A large
linked dataset does not make the project bundle grow by that dataset's size.

Linked files appear in the same searchable, sortable list with a **Linked** badge.
Their details show the relative path, folder label and location on this device.
You can edit their description, role, display name and logical classification;
these changes do not rename or move the original. Edit the original in its folder,
then choose **Rescan folder** to refresh discovery and changed-file indexing.
The existing **Replace file** action applies to embedded originals.

The folder manager supports **Save folder label**, **Rescan folder**, **Relink
folder…** and **Forget link…**. A missing, unlinked or stale folder remains visible
with an explanation and recovery action. Its files cannot be attached to the
assistant until its local link and scan are ready. Scans and document extraction
have limits; a large external file can remain listed as metadata only while its
contents are unavailable to the assistant. Processing status never means that all
files in an arbitrarily large folder were read.

Sharing the project carries folder labels, relative file references and catalogue
information. It does not share a device's absolute folder paths or grant permission
to read another machine. On another device, explicitly use **Relink folder…** to
choose the corresponding directory. Linked files are not a portable snapshot of
their originals; use **Add files** for reference material that must travel inside
the bundle with its exact bytes.

**Remove from project** hides a linked file from this project's folder discovery;
it never deletes the source file. **Forget link…** removes the folder connection
and its catalogue entries. Its confirmation says **Files on disk are kept**.
Neither action deletes the physical folder or its contents.

## Use documents with the assistant

The chat's **Add files** imports into the same library. **Choose project files**
attaches existing files to a message. You can also use **Attach to chat** from a
file's details. Up to three context sources can be attached per message; importing
more files is allowed and opens a choice of which to attach.

Attach a PDF page, document section, workbook sheet/cell range or text-line range
when only one part matters. Add a message explaining the task, then send. Removing
an attachment chip leaves the library file in place.

The assistant discovers available documents and reads relevant excerpts through
the existing context system. Importing does not upload the whole library to a
model or memory provider. Selected evidence goes to your chosen assistant when
needed. Previous excerpts may remain in the conversation until context compaction;
avoiding another file read does not eliminate those retained tokens.

Answers can cite a file and its page, section or cells. Clicking a citation opens
that location in Project Files. A citation to replaced or removed content is
labelled as historical and does not silently open different bytes as the evidence.
Expand the answer's context information to inspect what was actually supplied.

Clear **Available to the assistant** to exclude a file's name, description and
contents from future discovery and reading. You can still preview and export it.
These are local privacy choices, consistent with the existing context controls;
they are not permissions conferred on another machine by a shared project bundle.
Previously transmitted content cannot be recalled from a provider.

## Supported contents

| Files | What is available |
| --- | --- |
| Markdown, UTF-8 text and source text | Searchable contents and original line ranges; read-only preview. |
| PDF | Page previews and searchable existing text layers, with page citations. Image-only pages are identified; OCR is not automatic. |
| DOCX | Structural text, lists and tables, with section locations. Preview does not reproduce Word pagination. |
| XLSX | Visible sheets and cells, typed values, displayed values and stored formulas. Formulas are not recalculated; cached results may be old. Hidden contents require an explicit local selection. |
| CSV/TSV | Strings retain leading zeros; quoted fields and original source line ranges are preserved. |
| PNG, JPEG and WebP | Bounded image previews and metadata. Actual visual interpretation requires a qualified model connection. |
| Other or password-protected files | Originals can be stored/exported. Status explains when indexing or preview is unavailable. |

The first qualified visual route is **Ollama with gemma4:e2b**. Other model routes
show an unsupported or unverified image capability rather than silently dropping
image evidence. ouRGeo does not change models automatically. Large images/PDF pages
use bounded renditions and may omit fine detail or annotations; inspect the original
when fidelity matters. Text retrieval remains usable with text-only models.

**Partly searchable** identifies incomplete coverage. Descriptions help locate a
file but do not establish what every page or cell says. The assistant should read
the supporting source before stating a requirement or measurement.

## Replace, export, reindex and recover

**Export original** writes the original bytes. Previews are read-only: export to
edit in another application, then use **Replace file** to bring the revised copy
back. Review your description/role after replacement. Old citations keep their
old revision identity.

**Remove from project** withdraws a file from the working library. **Undo removal**
is available until save or project transition. The source originally imported
from disk remains intact. Saving commits the removal to the current bundle;
earlier saved/exported copies remain separate files.

New/replaced files index locally in the background. Use **Reindex file** or
**Reindex project files** to rebuild missing or outdated extracted contents.
Reindexing preserves your descriptions and makes no paid model calls. Progress,
cancellation and per-file errors identify what completed and how to recover.

Acknowledged imports and unsaved edits are journalled for crash recovery. Reopening
the matching project can restore its pending file changes. If the saved bundle
changed elsewhere, ouRGeo preserves the conflicting draft and offers recovery into
a separate saved project copy. It does not overwrite or merge it automatically.

Library limits are initially 2,000 files, 100 MiB per original and 1 GiB of total
original bytes. These limits apply separately from the R environment snapshot.
Extraction has additional page/cell/text limits; originals remain exportable when
only part of a document can be searched. Locked destinations, disk-full errors or
failed original-byte verification preserve the last successful project save.
If publication succeeds but the filesystem cannot confirm directory durability,
ouRGeo reports that warning and retains the pending file draft. Save again after
resolving the storage issue; reopening a verified intact bundle confirms its state.

Projects using this library require ouRGeo with Project Files support. Older
versions reject the newer project manifest rather than resaving a project without
its embedded files. Legacy projects open with an empty library and upgrade when
the library is first saved.

Native Windows and macOS verification is deferred. See the
[implementation record](project-files-implementation.md) for measured Linux checks
and the [specification](project-files-spec.md) for the full behaviour and limits.
