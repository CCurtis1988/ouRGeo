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

## Read and write project files from R

Five functions are available in every R session ouRGeo runs: the console,
document chunks, toolbox tools and Knit. Keep your usual reader or writer and
change only the path:

```r
# Read: an embedded file is copied (read-only, name and extension kept) into
# R's temporary directory; a linked file is read where it is.
sites <- read.csv(ourgeo_project_file("data/sites.csv"))
roads <- sf::st_read(ourgeo_project_file("roads.gpkg"))

# Write: any function that takes a file path.
write.csv(summary, ourgeo_project_path("tables/summary.csv"), row.names = FALSE)
ggsave(ourgeo_project_path("figures/map.png"), p, width = 7, height = 5)

# An existing file, now:
ourgeo_project_save("~/Downloads/standard.pdf", "reference/standard.pdf",
                    description = "Clearance standard")

ourgeo_project_files()      # list them
ourgeo_project_commit()     # save pending writes before the command ends
```

- **Names** are the names in the Project Files pane. `"tables/summary.csv"`
  means the logical folder `tables` and the file `summary.csv`; folders are labels,
  not locations on disk, and `..` is refused.
- **When it is saved:** `ourgeo_project_path()` returns a temporary path for the
  writer. The file is added to Project Files when the console command or chunk
  finishes, and the console reports it. Reading a staged name earlier in the same
  command saves it first, so writing and then reading inside one script works.
  A path that nothing wrote to is forgotten, with a note.
- **Writing the same name again replaces that file**, keeping its folder and
  description, as writing over a file on disk would. Identical bytes are reported
  as unchanged. `overwrite = FALSE` refuses instead. Names are unique across the
  library.
- **Saving the project** is what puts new or replaced files into the
  `.ourgeoproj`, exactly as with **Add files**. Until then they show
  **Added · Not saved** and are recoverable.
- **Linked folders:** `ourgeo_project_path("out/result.csv", location = "Field
  data")` writes into that linked folder on disk and rescans it.
  `ourgeo_project_file(name, location = "Field data")` picks the linked file when
  a name exists in two places.
- **Scratch** has no library. Save the project first.
- **Outside ouRGeo** (a plain `Rscript`), the functions stop with a message:
  export the file from the pane and use its path.

### Export dialogs

The plot export, map image export, map **Export Code** (tmap/ggplot) and the
Environment panel's **Export to Project Files** menu offer **Project Files** as
the destination, with an optional logical folder (`figures` or `tables` by default).
Each dialog echoes the R it ran with `ourgeo_project_path()` in place of the
path, for example
`ourgeo_save_plot(ourgeo_project_path("figures/plot.png"), width = 7, height = 5, units = "in", dpi = 300)`.
The map image is a screenshot with no R behind it, so the console records where
it was saved and points at **Export Code** for the reproducible version.

The Data Viewer's **Export layer** dialog (checked GeoPackage/GeoJSON export)
offers Project Files too. A new file is named after the layer (`data/roads.gpkg`
by default); **Add layer** and **Replace named layer** update a GeoPackage already
in Project Files. The export runs the same checks, review and staged readback as
a disk export, and only the verified file is saved into the library.

When an export would replace a file already in Project Files, ouRGeo asks first.
Tick **Don't ask again** to stop the question; turn it back on in
**Settings → Project Files**. R code never asks: `ourgeo_project_path()` replaces
a file of the same name, as writing over a file on disk does.

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

Native **Ollama vision models** support image interpretation when the server
explicitly reports vision capability. Other provider transports currently report
unsupported or unverified image capability. ouRGeo does not change models
automatically. Large images/PDF pages
use bounded renditions and may omit fine detail or annotations; inspect the original
when fidelity matters. Text retrieval remains usable with text-only models.

## Choose models for file tasks

Open **Settings → AI Assistant → File analysis models**. Document analysis and
image interpretation each have their own provider/model choice. **Use assistant
model** preserves the usual chat workflow. Choose a separate model and **Apply**
to use a specialist without changing the model at the top of the chat pane.
Task models share the connections and credentials configured under **Provider &
model**; these selectors do not change those connections or store another key.
The **Available models** list is shared with chat: it includes your saved/custom
chat choices, models used by other chats, Claude subscription aliases, eligible
ChatGPT subscription models, API models and models discovered on configured local
servers. Discovery happens automatically; **Refresh available models** checks
again. Select an existing model or enter a custom ID. Claude and ChatGPT reuse
their existing sign-in; no second registration is needed. The same model ID on
an API provider and a subscription remains a separate connection choice.

A separate document model analyses the bounded excerpts retrieved for your
question. The assistant receives both the original excerpt and a labelled
interpretation, with the original citation. A separate image model receives the
selected image or one selected PDF page; the chat assistant receives its textual
findings. It can therefore use a text-only model while a vision model interprets
the image. Image selection currently supports native Ollama vision models.

Imports and rescans still extract/index locally. Optionally enable **Generate AI
descriptions on import and rescan** to add catalogue descriptions for supported
new, changed or undescribed files. This is off by default. Jobs run one at a time,
using the corresponding document/image selection, and may incur model usage.
For documents they inspect the first bounded indexed excerpt, not every page.
Opening a project or enabling the option alone does not analyse the existing
library. Reindex files or rescan linked folders to request missing descriptions.

AI descriptions show their model, date and coverage in file details. They never
overwrite **Your description** or the local extraction description. Save the
project to retain them in its bundle. Current descriptions are reused when the
source and model are unchanged; changed source revisions invalidate them. These
descriptions aid discovery and are not evidence that a whole document was read.

The pane shows background progress, errors and **Cancel AI descriptions**.
Changing task settings, revoking source access, switching project or disabling
automatic descriptions stops affected work. A failed selected model produces an
error; it does not silently fall back to the assistant. Separate model calls use
the existing usage accounting and estimated chat-budget controls.

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
