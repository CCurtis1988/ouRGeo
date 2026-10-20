# Keeping your work: projects, scratch and recovery

This guide covers how ouRGeo keeps your work between saves, across restarts
and through a crash. The specification it implements, with its acceptance
checks, is [project-persistence-spec.md](project-persistence-spec.md).

## Saved projects

A saved project is a `.ourgeoproj` file. While you work, everything in it is
also kept **on this computer**, continuously:

- every open document, with unsaved edits, cursor, selection, scroll position,
  folding, Source/Visual mode and chunk output;
- data viewer and function editor tabs;
- the R environment, including your own environments and attached packages;
- the map: layers, symbology, named map sessions, extent, legend and
  geometry edits not yet written to R;
- plots, the console history and assistant chats;
- R's working directory and the environment the console works in.

Close ouRGeo or open another project and nothing is asked: the next time you
open the project — or launch ouRGeo, if it was open when you quit — it comes
back exactly as it was. The project menu says **Unsaved changes, kept on this
computer** while there are any. On a shared drive that matters: colleagues
opening the file see what was last **saved**, not your working copy.

**Save** writes everything into the project file. By default it does not save
your open scripts to their own files — their edits travel inside the project,
still unsaved, until you save each script. Turn on **Settings → Projects →
Save document edits when saving the project** to write them to their files on
every project save, including the automatic ones below. If a file cannot be
written, the save stops and offers Save As…, Skip this file or Cancel.

**Settings → Projects → When closing a saved project** chooses what closing or
switching does: keep the changes on this computer (the default), save the
project automatically, or ask. *Don't Save* still keeps them on this computer;
only **Revert to Saved…** in the project menu throws them away, after listing
what will be lost.

### The R environment

R objects are snapshotted after R has been idle for 30 seconds and something
has changed. Snapshots run in the background — on Linux and macOS a copy of the
R process writes them — so a command you run is never held up. Change the
interval in Settings → Projects (10 seconds to 30 minutes, or only when closing
or switching); the time the last snapshot took is shown beside it.

Some objects cannot survive a restart. ouRGeo rebuilds what it can — `.Rgeo`
datasets reconnect, raster map layers re-register, and terra rasters and
vectors are packed so they come back (a file-backed raster is reopened from its
file) — and names the rest, with the reason, in one warning: *Not restored:
con (database connection), r_tmp (temporary raster file is gone)*. The warning
has **Don't show again**; the console always gets the same list.

### When the project file changes elsewhere

If someone else saves the project file after you opened it, ouRGeo notices on
open and before Save, and offers:

- **Discard my changes and open theirs**;
- **Open my version and save it over theirs** (after a second confirmation
  naming when theirs was saved);
- **Resolve conflicts…** — a three-way comparison of your version, theirs, and
  the version you both started from. Changes only one side made are combined
  for you and listed. Where both changed the same thing you choose: per
  conflicting part of a document (mine, theirs, both, or edit by hand), and
  per R object, layer, plot, chat or project file (mine, theirs, or keep both —
  yours is renamed with `_mine`). Everything can be inspected first: `str()`,
  class and size for R objects, feature counts and fields for layers, both
  images for plots. Nothing is written until **Finish and save**; Cancel
  leaves your version open and asks again next time.

### One window per project

A project can be open in one ouRGeo window at a time. Opening it in a second
window says so and offers to show the first.

## Scratch

ouRGeo starts in **scratch** when no project was open at quit. Scratch keeps
its **untitled documents** — your notes — with their cursor and position, and
nothing else. Leaving it (quitting, or opening a project) drops its R objects,
map, plots, console, chats and open files, at that moment.

Before anything is dropped, ouRGeo lists it and offers **Save as project…**,
which keeps all of it, including edits to open files as unsaved edits inside
the new project. **Don't ask again** stops the offer; Settings → Prompts turns
it back on. Then each open file with unsaved edits is asked about: **Apply**
writes them to the file, **Drop** discards them, with **Apply to all
remaining**. A file that cannot be written is named, with Save As… or Drop.
Files dropped from scratch are listed under **Recently Closed Files** in the
project menu.

## Closing documents

Closing a document with unsaved edits — its ✕, Ctrl+W, Close Others, Close
All, or the assistant — asks **Save / Discard / Cancel** (or **Save to file… /
Discard / Cancel** for one never saved). Closing several at once offers
**Apply to all remaining**.

## After a crash

If ouRGeo did not close properly, the next launch recovers what it had kept and
says so: the documents restored (and any whose recovery copy could not be
read), the time of the R snapshot the objects came from — objects created after
it need re-running, and the console history shows what you ran — and the time
of the newest recovered change. This warning cannot be turned off.

If only R stops, nothing else is touched: R restarts, the objects come back
from the last snapshot, and a message says from when.

## Housekeeping

Drafts are kept until you delete them. **Settings → Projects → Stored unsaved
changes** lists them with their size and whether the project file still exists,
and deletes one, or all older than 30, 90 or 365 days. The health check
reports them too and offers the same clean-out, with your approval. Deleting a
draft never touches a project file.

Every "don't ask again" in ouRGeo is listed, as a switch, on **Settings →
Prompts**.

## Limits

- Windows and macOS have not been verified natively. On Windows the R
  snapshot runs in R itself (there is no `fork`), so it pauses R briefly; the
  idle interval keeps that away from your commands.
- A live drawing session in the map (an undo stack and a half-drawn shape) is
  not kept; staged geometry edits are.
- Unlabelled R Markdown chunks may lose their output on reopen; labelled
  chunks keep it.
- A data viewer tab comes back on the same object, but not at the row it was
  scrolled to or with its sort.
