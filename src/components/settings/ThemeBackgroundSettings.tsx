import React, { useEffect, useId, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, Check, ChevronLeft, Film, FolderPlus, Images, Loader2, RefreshCw, X } from 'lucide-react'
import { THEMES } from '@/lib/themes'
import { getThemeBackgroundPreferences, themeBackgroundGallery, type ThemeBackgroundImage } from '@/lib/theme-backgrounds'
import { useThemeBackgroundStore } from '@/store/theme-backgrounds'
import { useThemeStore } from '@/store/theme'
import { useUiStore } from '@/store/ui'
import { useThemeBackgroundPlaybackStore } from '@/lib/theme-background-playback'
import { useThemeBackgroundPoster } from '@/hooks/useThemeBackgroundPoster'
import { useThemeThumbnailVisibility } from '@/hooks/useThemeThumbnailVisibility'
import { ThemeBackgroundVisibility } from './ThemeBackgroundVisibility'

const buttonClass = 'rounded-md border border-geo-border px-2.5 py-1.5 text-xs text-foreground hover:border-geo-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-geo-accent disabled:opacity-50 disabled:cursor-not-allowed'

function imageCount(selected: number): string {
  return `${selected} ${selected === 1 ? 'image' : 'images'} selected`
}

function availableSelections(gallery: ThemeBackgroundImage[], ids: string[]): ThemeBackgroundImage[] {
  const images = new Map(gallery.map(image => [image.id, image]))
  return ids.flatMap(id => { const image = images.get(id); return image ? [image] : [] })
}

function CoverThumbnail({ image }: { image: ThemeBackgroundImage }): React.ReactElement {
  const poster = useThemeBackgroundPoster(image)
  return <img src={poster} alt="" className="h-14 w-24 shrink-0 rounded-md object-cover" />
}

function BackgroundPreview({ image, animate }: { image: ThemeBackgroundImage; animate: boolean }): React.ReactElement {
  const poster = useThemeBackgroundPoster(image, 'poster')
  return <img src={animate ? image.url : image.kind === 'gif' ? poster : image.posterUrl} alt={`${image.label} preview`} className="aspect-video w-full rounded-md object-cover" />
}

function GalleryThumbnail({ image, onError }: { image: ThemeBackgroundImage; onError: () => void }): React.ReactElement {
  const poster = useThemeBackgroundPoster(image)
  return <img src={poster} alt="" loading="lazy" decoding="async" onError={onError} className="h-full w-full object-cover transition-transform motion-safe:group-hover:scale-[1.03]" />
}

/** The gallery changes presentation preferences, leaving the theme's authored
 * artwork intact so resetting a shipped or imported theme is predictable. */
export function ThemeBackgroundSettings(): React.ReactElement {
  const themeId = useThemeStore(s => s.current)
  const revision = useThemeStore(s => s.revision)
  const preferences = useThemeBackgroundStore(s => s.preferences)
  const folders = useThemeBackgroundStore(s => s.folders)
  const initialised = useThemeBackgroundStore(s => s.initialized)
  const error = useThemeBackgroundStore(s => s.error)
  const init = useThemeBackgroundStore(s => s.init)
  const reducedMotion = useThemeBackgroundPlaybackStore(s => s.reducedMotion)
  useEffect(() => { void init().catch(() => undefined) }, [init])
  const settings = getThemeBackgroundPreferences(themeId, preferences)
  const gallery = themeBackgroundGallery(themeId, folders.filter(folder => folder.themeId === themeId && folder.status === 'ready').flatMap(folder => folder.images))
  const selected = availableSelections(gallery, settings.selectedIds)
  const cover = selected[0] ?? gallery[0]
  void revision
  return <button
    type="button"
    data-ourgeo-id="settings.themeBackgrounds"
    onClick={() => useUiStore.getState().showDialog('theme-backgrounds')}
    className="mt-3 flex w-full items-center gap-3 rounded-lg border border-geo-border p-2 text-left transition-colors hover:border-geo-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-geo-accent"
  >
    {cover && <CoverThumbnail image={cover} />}
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground"><Images className="h-3.5 w-3.5" />Background images…</span>
      <span className="mt-1 block text-[11px] leading-relaxed text-foreground/80">
        {error ? 'Background settings need attention. Open to retry or reset.' : !initialised ? 'Loading saved backgrounds…' : selected.length > 1 ? reducedMotion ? `${imageCount(selected.length)} · slideshow paused by reduced motion` : `${imageCount(selected.length)} · changes every ${settings.intervalSeconds} seconds` : selected.length === 0 ? 'Saved images unavailable · showing default' : cover.kind === 'gif' ? reducedMotion ? 'One animation · still frame while reduced motion is enabled' : 'One animation · loops continuously' : 'One image · fixed background'}
      </span>
      <span className="block text-[10px] text-foreground/80">Choose artwork, GIFs and linked image folders for {THEMES[themeId]?.label ?? themeId}.</span>
    </span>
  </button>
}

function GalleryImage({ image, selected, onlySelection, disabled, onToggle }: {
  image: ThemeBackgroundImage
  selected: boolean
  onlySelection: boolean
  disabled: boolean
  onToggle: () => void
}): React.ReactElement {
  const [failed, setFailed] = useState(false)
  const { ref, visible } = useThemeThumbnailVisibility()
  const animationLabel = image.kind === 'gif' ? image.source === 'folder' && !/\.gif$/i.test(image.label) || /^data:image\/(?:webp|png)[;,]/i.test(image.url) ? 'Animated' : 'GIF' : null
  return <button
    ref={ref}
    type="button"
    aria-pressed={selected}
    aria-label={`${image.label}${animationLabel ? `, ${animationLabel}` : ''}`}
    title={onlySelection ? 'Keep at least one image selected. Select another image first to replace this one.' : image.label}
    disabled={disabled}
    onClick={onToggle}
    className={`group relative overflow-hidden rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-geo-accent disabled:cursor-default ${selected ? 'border-geo-accent ring-1 ring-geo-accent' : 'border-geo-border hover:border-geo-muted'}`}
  >
    <span className="relative block aspect-video overflow-hidden bg-geo-bg">
      {failed ? <span className="flex h-full items-center justify-center gap-1 p-3 text-[11px] text-foreground/80"><AlertTriangle className="h-4 w-4" />Preview unavailable</span> : visible ? <GalleryThumbnail image={image} onError={() => setFailed(true)} /> : null}
      {animationLabel && <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded border border-geo-border bg-geo-panel px-1.5 py-0.5 text-[10px] font-semibold text-foreground"><Film aria-hidden className="h-3 w-3" />{animationLabel}</span>}
      {selected && <span aria-hidden className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-geo-panel text-geo-accent shadow"><Check className="h-3.5 w-3.5" /></span>}
    </span>
    <span className="block truncate px-2 py-1.5 text-[11px] text-foreground">{image.label}</span>
  </button>
}

interface ThemeBackgroundDialogProps { open: boolean; onOpenChange: (open: boolean) => void }

/** A sibling of Settings: one modal and one keyboard focus scope at a time. */
export function ThemeBackgroundDialog({ open, onOpenChange }: ThemeBackgroundDialogProps): React.ReactElement {
  const themeId = useThemeStore(s => s.current)
  const revision = useThemeStore(s => s.revision)
  const store = useThemeBackgroundStore()
  const { init, refreshFolders } = store
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [intervalDraft, setIntervalDraft] = useState('30')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [playPreview, setPlayPreview] = useState(false)
  const reducedMotion = useThemeBackgroundPlaybackStore(s => s.reducedMotion)
  const intervalId = useId()
  const settings = getThemeBackgroundPreferences(themeId, store.preferences)
  const folders = store.folders.filter(folder => folder.themeId === themeId)
  const gallery = themeBackgroundGallery(themeId, folders.filter(folder => folder.status === 'ready').flatMap(folder => folder.images))
  const selected = availableSelections(gallery, settings.selectedIds)
  const unavailable = settings.selectedIds.filter(id => !gallery.some(image => image.id === id))
  const preview = gallery.find(image => image.id === previewId) ?? selected[0] ?? gallery[0]
  const slideshow = selected.length > 1
  const singleAnimation = selected.length === 1 && selected[0].kind === 'gif'
  void revision
  useEffect(() => { setIntervalDraft(String(settings.intervalSeconds)) }, [themeId, settings.intervalSeconds])
  useEffect(() => { setPreviewId(null); setPlayPreview(false); setNotice(null) }, [themeId, open])
  useEffect(() => {
    if (open) {
      // Failures are rendered from the store below; avoid an unhandled promise
      // when the settings file is damaged or a linked drive is unavailable.
      void init().catch(() => undefined)
      void refreshFolders().catch(() => undefined)
    }
  }, [open, init, refreshFolders])
  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setNotice(null)
    try { await operation() } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const commitInterval = (): void => {
    const value = Number(intervalDraft)
    if (!Number.isInteger(value) || value < 5 || value > 3600) { setNotice('Choose a whole number from 5 to 3,600 seconds.'); return }
    setNotice(null)
    // Saving on blur must not disable the image the user is clicking next.
    // The store serialises this with any selection written by that click.
    if (value !== settings.intervalSeconds) void store.setInterval(themeId, value).catch(error => setNotice(error instanceof Error ? error.message : String(error)))
  }
  const choose = (image: ThemeBackgroundImage): void => {
    const removing = settings.selectedIds.includes(image.id) && settings.selectedIds.length > 1
    setPreviewId(removing ? selected.find(item => item.id !== image.id)?.id ?? 'default' : image.id)
    setPlayPreview(false)
    if (settings.selectedIds.length === 1 && settings.selectedIds[0] === image.id) return
    void run(() => store.toggleImage(themeId, image.id))
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content
        data-ourgeo-id="themeBackgrounds.dialog"
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[920px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-geo-border bg-geo-panel shadow-xl focus:outline-none"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-geo-border px-5 py-4">
          <div>
            <Dialog.Title className="text-sm font-semibold text-foreground">{THEMES[themeId]?.label ?? themeId} backgrounds</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs text-foreground/80">Choose one image for a fixed background, or several for a slideshow. Changes apply immediately.</Dialog.Description>
          </div>
          <Dialog.Close aria-label="Close background settings" className="rounded p-1 text-foreground/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-geo-accent"><X className="h-4 w-4" /></Dialog.Close>
        </div>
        <div className="min-h-0 overflow-y-auto p-5">
          {(notice || store.error || store.folderError) && <div role="alert" className="mb-4 rounded-md border border-geo-warning/50 bg-geo-warning/10 p-3 text-xs text-foreground">{notice ?? store.error ?? store.folderError}</div>}
          {!store.initialized ? <div className="space-y-3 py-5 text-xs text-foreground/80"><p>Loading background preferences…</p><button type="button" className={buttonClass} onClick={() => void run(() => store.init())}>Retry loading backgrounds</button><button type="button" className={`${buttonClass} ml-2`} onClick={() => void run(() => store.resetAll())}>Reset saved background settings</button></div> : <>
            <div className="mb-5 flex flex-col gap-4 rounded-lg border border-geo-border bg-geo-bg/40 p-3 sm:flex-row">
              {preview && <div className="relative w-full shrink-0 sm:w-52">
                <BackgroundPreview image={preview} animate={playPreview && !reducedMotion} />
                {preview.kind === 'gif' && <button type="button" className={`${buttonClass} mt-2 w-full bg-geo-panel`} disabled={reducedMotion} onClick={() => setPlayPreview(value => !value)}>{playPreview ? 'Pause GIF preview' : 'Play GIF preview'}</button>}
              </div>}
              <div className="min-w-0 flex-1 space-y-2">
                <p aria-live="polite" className="text-xs font-medium text-foreground">{imageCount(selected.length)}{slideshow ? reducedMotion ? ' · slideshow paused' : ' · slideshow' : singleAnimation ? reducedMotion ? ' · still frame' : ' · looping animation' : ' · fixed background'}</p>
                <p className="text-[11px] leading-relaxed text-foreground/80">Selections and linked folders are saved separately for each theme. Keep at least one image selected.</p>
                <div className="flex items-center gap-2">
                  <label htmlFor={intervalId} className="text-xs text-foreground">Switch every</label>
                  <input id={intervalId} data-ourgeo-id="themeBackgrounds.interval" type="number" min={5} max={3600} step={1} value={intervalDraft} disabled={!slideshow || busy} onChange={event => setIntervalDraft(event.target.value)} onBlur={commitInterval} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} aria-describedby={`${intervalId}-hint`} className="w-20 rounded-md border border-geo-border bg-geo-bg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-geo-accent disabled:opacity-50" />
                  <span className="text-xs text-foreground/80">seconds</span>
                </div>
                <p id={`${intervalId}-hint`} className="text-[10px] text-foreground/80">{slideshow ? '5 to 3,600 seconds. Timing starts again after a selection changes.' : singleAnimation ? 'The animation has its own loop timing. Select another image to enable slideshow timing.' : 'Select two or more available images to set slideshow timing.'}</p>
                {reducedMotion && <p className="text-[11px] text-foreground/80">Reduced motion is enabled on this device. Slideshows stay still and GIFs use a still frame.</p>}
              </div>
            </div>
            {unavailable.length > 0 && <div className="mb-4 rounded-lg border border-geo-warning/40 p-3 text-xs text-foreground"><p>{unavailable.length} selected {unavailable.length === 1 ? 'image is' : 'images are'} unavailable. Rescan or locate its linked folder. The default background is used if no selected images are available.</p><button type="button" className={`${buttonClass} mt-2`} disabled={busy} onClick={() => void run(() => store.setSelection(themeId, selected.length ? selected.map(image => image.id) : ['default']))}>Remove unavailable selections</button></div>}
            <ThemeBackgroundVisibility showError={false} />
            <section aria-label="Theme image gallery" className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-xs font-medium text-foreground">Theme artwork</h3><button type="button" data-ourgeo-id="themeBackgrounds.reset" className="text-[11px] text-foreground/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-geo-accent" disabled={busy} onClick={() => void run(() => store.reset(themeId))}>Restore default selection</button></div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{gallery.filter(image => image.source !== 'folder').map(image => <GalleryImage key={image.id} image={image} selected={settings.selectedIds.includes(image.id)} onlySelection={settings.selectedIds.length === 1 && settings.selectedIds[0] === image.id} disabled={busy} onToggle={() => choose(image)} />)}</div>
            </section>
            <section aria-label="Linked image folders" className="mt-6 border-t border-geo-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-medium text-foreground">Linked image folders</h3><button type="button" data-ourgeo-id="themeBackgrounds.linkFolder" className={`${buttonClass} inline-flex items-center gap-1.5`} disabled={busy || store.foldersLoading} onClick={() => void run(() => store.linkFolder(themeId))}><FolderPlus className="h-3.5 w-3.5" />Link image folder…</button></div>
              <p className="mt-1 text-[11px] leading-relaxed text-foreground/80">Use pictures from folders on this device. Files stay in their original location; forgetting a folder leaves its files on disk. PNG, JPEG, WebP and GIF are supported.</p>
              {store.foldersLoading && <p role="status" className="mt-3 flex items-center gap-2 text-xs text-foreground/80"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading image folders…</p>}
              {!folders.length && !store.foldersLoading && <p className="mt-3 rounded-md border border-dashed border-geo-border p-4 text-center text-xs text-foreground/80">No image folders linked to this theme yet.</p>}
              {folders.map(folder => <div key={folder.id} className="mt-3 rounded-lg border border-geo-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1"><h4 className="break-words text-xs font-medium text-foreground">{folder.name}<span className="ml-2 text-[10px] font-normal text-foreground/80">{folder.status === 'missing' ? 'Folder unavailable' : `${folder.images.length} images`}</span></h4><p className="mt-1 break-all text-[10px] text-foreground/80">{folder.path}</p></div>
                  <div className="flex gap-1"><button type="button" aria-label={`Rescan ${folder.name}`} className={buttonClass} disabled={busy} onClick={() => void run(() => store.rescanFolder(folder.id))}><RefreshCw aria-hidden className="mr-1 inline h-3 w-3" />Rescan</button><button type="button" aria-label={`Locate ${folder.name}`} className={buttonClass} disabled={busy} onClick={() => void run(() => store.relinkFolder(folder.id))}>Locate…</button><button type="button" aria-label={`Forget ${folder.name}`} className={buttonClass} disabled={busy} onClick={() => void run(() => store.forgetFolder(folder.id))}>Forget</button></div>
                </div>
                {folder.warning && <p className="mt-2 flex items-start gap-1.5 text-[11px] text-foreground"><AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-geo-warning" />{folder.warning}</p>}
                {folder.images.length > 0 && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{gallery.filter(image => image.folderId === folder.id).map(image => <GalleryImage key={image.id} image={image} selected={settings.selectedIds.includes(image.id)} onlySelection={settings.selectedIds.length === 1 && settings.selectedIds[0] === image.id} disabled={busy} onToggle={() => choose(image)} />)}</div>}
              </div>)}
            </section>
          </>}
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-geo-border px-5 py-3"><button type="button" className="inline-flex items-center gap-1 text-xs text-foreground/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-geo-accent" onClick={() => useUiStore.getState().showDialog('settings')}><ChevronLeft className="h-3.5 w-3.5" />Appearance settings</button><Dialog.Close className={buttonClass}>Done</Dialog.Close></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
