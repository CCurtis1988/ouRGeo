# Theme backgrounds

Open **Settings → Appearance → Background images…** beneath the app themes.
The gallery belongs to the current app theme; changing a code or Markdown
palette does not change its backgrounds.

Every painted theme includes its original artwork, five additional paintings in
the same illustration style, and a peaceful looping GIF made from the original.
Legacy and custom themes retain their own original scene or uploaded artwork
and offer the related painted gallery as additional choices.

The **Field collection** adds 13 website-inspired themes with six realistic
nature photographs each. Those galleries contain stills for now. See the
[Field collection guide](field-themes.md) for palettes and artwork locations.

## Choose your backgrounds

- Select **one image** for a fixed background.
- Select **two or more images** for a slideshow. Images run in the order you
  select them, with a short crossfade.
- Set **Switch every** to a whole number from **5 to 3,600 seconds**.
  The timing applies to the current theme and is remembered between sessions.
- To replace a single selected image, select the new image, then deselect the
  old one. At least one image stays selected.
- **Restore default selection** returns this theme to its original artwork.

A **GIF** badge identifies an animated image. Gallery thumbnails stay still;
select a GIF and use **Play GIF preview** to inspect its motion. Selecting a
single GIF displays that animation as the background. Additional animated WebP
files have an **Animated** badge.

The selection summary says **looping animation** for a single GIF. Its loop
timing comes from the image; **Switch every** controls changes between selected
images. Gallery thumbnails and paused previews intentionally show a still frame.
With reduced motion enabled, the summary explains why the animation stays still.

All editor panes share the same slideshow clock. Opening a tab, moving an editor
or opening the gallery does not restart it. Changing the selected images or
timing starts a new interval. The gallery preview shows the image being
inspected; it does not fast-forward the editor's slideshow.

With the device's **reduced motion** preference enabled, GIFs use a still frame
and slideshows stay on a single image. Animation also pauses while ouRGeo is
hidden. There is no background processing of the whole gallery during a
slideshow: only the current image and its next selected neighbour are preloaded.

## Link an image folder

In **Linked image folders**, choose **Link image folder…**. You can link more than
one folder and link the same folder to several themes. Each theme remembers its
own selections.

PNG, JPEG, WebP and GIF are supported. The folder is scanned when linked and
when ouRGeo starts. Use **Rescan** after adding, replacing or removing pictures.
Subfolders are included within the limits shown below. Unsupported or unreadable
files are skipped with an explanation.

- **Rescan** refreshes the available images. Replacing a file at the same
  relative path keeps its selection.
- **Locate…** reconnects a moved folder or a drive that has changed location.
  Images at the same relative paths retain their selections.
- **Forget** removes the link and its background selections. It **never deletes
  or modifies the original folder or images**.

If an image or drive is unavailable, its selection is kept for recovery and the
slideshow skips it. If every selected image is unavailable, ouRGeo shows the
theme's original artwork. Reconnect the drive and rescan, locate the folder, or
remove the unavailable selections.

Linked images may be up to **8 MiB and 24 megapixels** each. A scan includes up
to **200 images**, **2,000 entries**, **100 subfolders** and **six nested
subfolder levels**, with a bounded scan time. Hidden entries, symbolic links and
hard links are excluded. Link a smaller folder if a scan reaches a limit.
These limits keep previews responsive and avoid accidentally traversing an
entire drive.

## Where the settings live

Background choices and slideshow timing are device preferences in
`theme-backgrounds.json`. Folder links are in
`theme-background-folders.json` under ouRGeo's application data directory.
They are separate from project files, chat attachments, AI context sources and
the theme's authored definition.

Exporting a `.ourgeotheme.json` carries the artwork authored in Theme Studio;
it does not copy linked folders or this device's slideshow preferences.
Use Theme Studio to embed a portable custom backdrop. Background selections
leave theme icons, interface colours, syntax palettes, opacity and greyscale
settings intact.

If saved background preferences cannot be read or saved, the gallery offers
retry/reset controls and explains the problem. Resetting background preferences
does not delete linked files.

## Background visibility

Appearance and the background gallery share a **Background visibility** slider.
It previews changes immediately across all editors and saves on release, keyboard
release or leaving the control. Closing the dialog also saves an unfinished drag.
0% hides the image; 100% shows its original colours without opacity or greyscale
filters. Values are remembered separately for each theme, including custom themes
and linked-folder images. **Theme default** restores the authored presentation
without changing selected images or slideshow timing. **Restore default selection**
preserves visibility. Light Field themes default to 35%; their syntax palettes
are adjusted for readability against that stronger photograph layer. Higher
user-selected values may make text harder to read.

Settings has four collection tabs: Illustrated, Legacy, Field collection and
Custom. Theme Studio shows the same four collapsible App theme groups and opens
the selected theme’s group. Custom copies appear in Custom even when based on
a Field or Legacy template. Code and Markdown palettes retain Built in/Custom
organisation because their palettes do not share app theme collections.

The optional `imageStrength` field (0–100) lives in the existing version-1
`theme-backgrounds.json` preferences. Omitted values use the theme default, so
older settings retain selections and intervals without a migration.
