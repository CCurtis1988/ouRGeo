import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react'
import {
  AlertCircle, CheckCircle2, Clock3, ImagePlus, Loader2, RefreshCw, Star, Trash2,
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@/lib/utils'
import { transcodeForUpload } from '@/lib/forum/transcode'
import * as storeClient from '@/lib/plugin-store/client'
import { storeErrorMessage } from '@/lib/plugin-store/client'
import {
  MAX_SCREENSHOTS, baseName, describeRejected, formatBytes, planScreenshotAdd,
  summarizeScreenshots, type ScreenshotState,
} from '@/lib/plugin-store/screenshots'

// Screenshots on a plugin's store page.
//
// This exists as its own component because attaching a picture is not one act
// but four — pick, resize, upload, record — and the old panel showed none of
// them. It opened the DOCUMENT picker (so a .png was hidden behind "All
// Files"), took one file at a time, did the whole round trip with nothing on
// screen, and then either grew a 64px thumbnail or wrote a sentence into an
// error box three scrolls down. An author could not tell acceptance from
// refusal, which is the report this was written from.
//
// Three rules follow from that, and they are what the code is shaped around:
//
//  1. **Every file gets a row the moment it is chosen**, before any work — so
//     choosing five files visibly produces five things.
//  2. **A row states which of the four steps it is on**, and "on your store
//     page" is claimed for nothing else. A queued screenshot says it is queued.
//  3. **Nothing is dropped silently.** A file that is not an image, or is over
//     the limit, is named with the reason.
//
// The ordering constraint that caused the original confusion is real and is not
// ours to remove: `plugin_media` references the plugin row, which is written by
// the first submission, so before that there is genuinely nowhere to put a
// picture. Rather than refuse, screenshots picked early are prepared, shown, and
// uploaded by `flush()` the moment the submission creates the row.

interface Shot {
  key: string
  name: string
  state: ScreenshotState
  error: string | null
  /** Blob URL for a local pick, CDN URL for one already on the store page. */
  preview: string
  /** True when `preview` is ours to revoke. */
  previewOwned: boolean
  /** Size as it will be stored, after resizing. */
  bytes: number
  /** Size on disk, for local picks — what the resize is measured against. */
  sourceBytes: number | null
  width: number
  height: number
  alt: string
  remote: { id: string; path: string } | null
  /** Held until the upload succeeds, so a failure can be retried without the file. */
  payload: { bytes: Uint8Array; mime: string } | null
}

export interface PluginScreenshotsHandle {
  /** Upload everything waiting on the plugin row the submission just created. */
  flush(): Promise<{ uploaded: number; failed: number }>
  /** Re-read the store's copy — called after a submission claims the id. */
  refresh(): Promise<void>
}

interface Props {
  slug: string | null
  signedIn: boolean
  /** The submission is building or uploading; leave the screenshots alone. */
  submitting: boolean
  /** Fired whenever the set changes, so the dialog can block Submit mid-upload. */
  onBusyChange: (busy: boolean) => void
}

let seq = 0
const nextKey = (): string => `shot-${++seq}`

export const PluginScreenshots = forwardRef<PluginScreenshotsHandle, Props>(
  function PluginScreenshots({ slug, signedIn, submitting, onBusyChange }, ref) {
    const [shots, setShots] = useState<Shot[]>([])
    const [claimed, setClaimed] = useState<boolean | null>(null)
    const [notMine, setNotMine] = useState(false)
    const [note, setNote] = useState<string | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [working, setWorking] = useState(false)

    // The list is read inside async loops that outlive the render they started
    // in, so they read this rather than closing over `shots` — the stale-closure
    // trap `useGeometryCommit` documents, in its upload-queue form.
    //
    // Every write goes through `apply`, which updates the ref INSIDE the state
    // updater rather than during the next render. That matters here and nowhere
    // else in the app: an upload loop patches a shot and then immediately reads
    // it back, in the same tick, and a ref refreshed only on render would hand
    // it the row as it was before the patch — a screenshot that had just been
    // prepared would read as having no bytes and be skipped in silence. For the
    // same reason there is no render-time assignment: a re-render caused by
    // anything else would roll the ref back to the last committed list.
    const shotsRef = useRef<Shot[]>([])
    const apply = useCallback((fn: (all: Shot[]) => Shot[]) => {
      setShots((all) => {
        const next = fn(all)
        shotsRef.current = next
        return next
      })
    }, [])

    const patch = useCallback((key: string, next: Partial<Shot>) => {
      apply((all) => all.map((s) => (s.key === key ? { ...s, ...next } : s)))
    }, [apply])

    // Blob URLs are per-document and are not collected with the component.
    useEffect(() => () => {
      for (const s of shotsRef.current) if (s.previewOwned) URL.revokeObjectURL(s.preview)
    }, [])

    const busy = working || shots.some((s) => s.state === 'preparing' || s.state === 'uploading')
    useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])

    /** What the store already holds, so a second visit is not a second upload. */
    const refresh = useCallback(async () => {
      if (!slug || !signedIn) { setClaimed(null); return }
      try {
        const list = await storeClient.media(slug)
        setClaimed(list.claimed)
        setNotMine(list.claimed && !list.mine)
        setLoadError(null)
        apply((local) => {
          const pending = local.filter((s) => s.state !== 'attached')
          const attached: Shot[] = list.items.map((m) => ({
            key: `remote-${m.id}`,
            name: baseName(m.path),
            state: 'attached',
            error: null,
            preview: m.url,
            previewOwned: false,
            bytes: m.bytes,
            sourceBytes: null,
            width: m.width,
            height: m.height,
            alt: m.alt ?? '',
            remote: { id: m.id, path: m.path },
            payload: null,
          }))
          return [...attached, ...pending]
        })
      } catch (e) {
        setLoadError(storeErrorMessage(e))
      }
    }, [slug, signedIn, apply])

    useEffect(() => { void refresh() }, [refresh])

    /**
     * Upload one prepared screenshot. Returns whether it landed.
     *
     * Takes the row rather than its key: the caller always has it, and looking
     * it up would reintroduce the ordering hazard `apply` exists to remove.
     */
    const upload = useCallback(async (shot: Shot, sortOrder: number): Promise<boolean> => {
      const key = shot.key
      if (!shot.payload || !slug) return false
      patch(key, { state: 'uploading', error: null })
      try {
        const { id, path, url } = await storeClient.uploadMedia({
          slug,
          bytes: shot.payload.bytes,
          mime: shot.payload.mime,
          width: shot.width,
          height: shot.height,
          alt: shot.alt || undefined,
          sortOrder,
        })
        // The CDN URL is the proof it is really there, so the card switches to
        // it — a thumbnail that keeps showing the local file cannot tell an
        // upload that worked from one that did not.
        if (shot.previewOwned) URL.revokeObjectURL(shot.preview)
        patch(key, {
          state: 'attached',
          remote: { id, path },
          preview: url,
          previewOwned: false,
          payload: null,
        })
        return true
      } catch (e) {
        patch(key, { state: 'failed', error: storeErrorMessage(e) })
        return false
      }
    }, [slug, patch])

    /**
     * Read, resize and re-encode the picked files, then upload what can go now.
     *
     * Sequential on purpose. Five parallel uploads finish in an order nobody
     * chose, which decides which screenshot becomes the store card's picture;
     * one at a time keeps `sortOrder` equal to the order they were picked in.
     */
    const add = useCallback(async () => {
      if (!slug) return
      const paths = await window.electronAPI.dialog.openImages('Add Screenshots')
      if (!paths.length) return

      const plan = planScreenshotAdd(paths, shotsRef.current.length)
      setNote(describeRejected(plan.rejected))
      if (!plan.accepted.length) return

      const fresh: Shot[] = plan.accepted.map((f) => ({
        key: nextKey(),
        name: f.name,
        state: 'preparing',
        error: null,
        preview: '',
        previewOwned: false,
        bytes: 0,
        sourceBytes: null,
        width: 0,
        height: 0,
        alt: '',
        remote: null,
        payload: null,
      }))
      apply((all) => [...all, ...fresh])
      setWorking(true)

      try {
        for (const [i, file] of plan.accepted.entries()) {
          const key = fresh[i].key
          let prepared: Shot
          try {
            const b64 = await window.electronAPI.file.readBinary(file.path)
            const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
            const shrunk = await transcodeForUpload(raw, file.mime)
            const preview = URL.createObjectURL(
              new Blob([shrunk.bytes as BlobPart], { type: shrunk.mime }))
            const ready: Partial<Shot> = {
              state: 'waiting',
              preview,
              previewOwned: true,
              bytes: shrunk.bytes.byteLength,
              sourceBytes: raw.byteLength,
              width: shrunk.width,
              height: shrunk.height,
              payload: { bytes: shrunk.bytes, mime: shrunk.mime },
            }
            patch(key, ready)
            prepared = { ...fresh[i], ...ready }
          } catch (e) {
            patch(key, { state: 'failed', error: storeErrorMessage(e) })
            continue
          }
          // Its place in the list IS its sort order: the store's card takes the
          // first screenshot, so the order they were picked in is the order they
          // should arrive in.
          if (claimed) await upload(prepared, shotsRef.current.findIndex((s) => s.key === key))
        }
      } finally {
        setWorking(false)
      }
    }, [slug, claimed, apply, patch, upload])

    const flush = useCallback(async (): Promise<{ uploaded: number; failed: number }> => {
      const pending = shotsRef.current.filter((s) => s.state === 'waiting' && s.payload)
      if (!pending.length) return { uploaded: 0, failed: 0 }
      setClaimed(true)
      setWorking(true)
      let uploaded = 0
      let failed = 0
      try {
        for (const shot of pending) {
          const order = shotsRef.current.findIndex((s) => s.key === shot.key)
          if (await upload(shot, order)) uploaded++
          else failed++
        }
      } finally {
        setWorking(false)
      }
      return { uploaded, failed }
    }, [upload])

    useImperativeHandle(ref, () => ({ flush, refresh }), [flush, refresh])

    /**
     * Remove one, and mean it.
     *
     * An attached screenshot is on a public page, so taking it out of this list
     * has to take it off that page too — the old panel only forgot about it
     * locally, which left the author looking at a list that did not describe
     * their store page.
     */
    const remove = useCallback(async (shot: Shot) => {
      if (shot.remote) {
        setWorking(true)
        try {
          await storeClient.deleteMedia(shot.remote.id, shot.remote.path)
        } catch (e) {
          patch(shot.key, { error: storeErrorMessage(e) })
          return
        } finally {
          setWorking(false)
        }
      }
      if (shot.previewOwned) URL.revokeObjectURL(shot.preview)
      apply((all) => all.filter((s) => s.key !== shot.key))
    }, [apply, patch])

    /** The first screenshot is the catalogue card's picture; say so, and move it. */
    const makeCover = useCallback(async (shot: Shot) => {
      apply((all) => [shot, ...all.filter((s) => s.key !== shot.key)])
      const reordered = shotsRef.current
      const attached = reordered.filter((s) => s.remote)
      for (const [i, s] of attached.entries()) {
        await storeClient.updateMedia({ id: s.remote!.id, sortOrder: i }).catch(() => undefined)
      }
    }, [apply])

    const saveAlt = useCallback((shot: Shot, alt: string) => {
      patch(shot.key, { alt })
      if (shot.remote) void storeClient.updateMedia({ id: shot.remote.id, alt }).catch(() => undefined)
    }, [patch])

    const full = shots.length >= MAX_SCREENSHOTS
    const canAdd = !!slug && !submitting && !full

    return (
      <section className="rounded border border-geo-border p-2.5 space-y-2" data-ourgeo-id="pluginSubmit.screenshots">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-geo-muted uppercase tracking-wider">
              Screenshots
            </p>
            <p className="text-[11px] text-foreground mt-0.5" aria-live="polite">
              {summarizeScreenshots(shots.map((s) => s.state))}
            </p>
          </div>
          <Button
            variant="ghost" size="sm" className="h-7 text-xs gap-1.5 shrink-0"
            disabled={!canAdd} onClick={() => void add()}
            data-ourgeo-id="pluginSubmit.addScreenshots"
          >
            <ImagePlus className="w-3 h-3" /> Add screenshots…
          </Button>
        </header>

        <p className="text-[10px] text-geo-muted leading-snug">
          Up to {MAX_SCREENSHOTS}, chosen several at a time. Each one is resized to fit
          the store&rsquo;s 400&nbsp;KB limit before it is uploaded, so what you see below is
          what people will see. The first is the picture on your plugin&rsquo;s card.
        </p>

        {signedIn && claimed === false && (
          <p className="text-[10px] text-geo-muted leading-snug border-l-2 border-geo-accent/50 pl-2">
            This plugin is not in the store yet, so there is nothing for a screenshot to
            attach to. Pick them now — ouRGeo uploads them as soon as you submit.
          </p>
        )}

        {notMine && (
          <p className="text-[10px] text-geo-error leading-snug">
            The id <span className="text-foreground">{slug}</span> belongs to another account,
            so screenshots cannot be added to it.
          </p>
        )}

        {!signedIn && (
          <p className="text-[10px] text-geo-muted leading-snug">
            Sign in to ourgeo.dev to upload screenshots. A submission file saved to disk
            carries the plugin, not its pictures.
          </p>
        )}

        {loadError && <p className="text-[10px] text-geo-error leading-snug">{loadError}</p>}
        {note && <p className="text-[10px] text-geo-warning leading-snug">{note}</p>}
        {full && (
          <p className="text-[10px] text-geo-muted leading-snug">
            That is {MAX_SCREENSHOTS} — remove one to add another.
          </p>
        )}

        {shots.length > 0 && (
          <ul className="grid grid-cols-2 gap-2">
            {shots.map((shot, i) => (
              <ShotCard
                key={shot.key}
                shot={shot}
                isCover={i === 0}
                disabled={submitting}
                onRemove={() => void remove(shot)}
                onRetry={() => void upload(shot, i)}
                onCover={() => void makeCover(shot)}
                onAlt={(v) => saveAlt(shot, v)}
              />
            ))}
          </ul>
        )}
      </section>
    )
  }
)

const STATE_LABEL: Record<ScreenshotState, string> = {
  preparing: 'Resizing…',
  waiting: 'Waiting for the submission',
  uploading: 'Uploading…',
  attached: 'On your store page',
  failed: 'Not uploaded',
}

function StateBadge({ shot }: { shot: Shot }): React.ReactElement {
  const tone =
    shot.state === 'attached' ? 'text-geo-success'
      : shot.state === 'failed' ? 'text-geo-error'
        : 'text-geo-muted'
  const Icon =
    shot.state === 'attached' ? CheckCircle2
      : shot.state === 'failed' ? AlertCircle
        : shot.state === 'waiting' ? Clock3
          : Loader2
  return (
    <span className={cn('flex items-center gap-1 text-[10px]', tone)}>
      <Icon className={cn('w-3 h-3 shrink-0', shot.state === 'preparing' || shot.state === 'uploading'
        ? 'animate-spin' : '')} />
      {STATE_LABEL[shot.state]}
    </span>
  )
}

function ShotCard({
  shot, isCover, disabled, onRemove, onRetry, onCover, onAlt,
}: {
  shot: Shot
  isCover: boolean
  disabled: boolean
  onRemove: () => void
  onRetry: () => void
  onCover: () => void
  onAlt: (value: string) => void
}): React.ReactElement {
  const [alt, setAlt] = useState(shot.alt)
  useEffect(() => { setAlt(shot.alt) }, [shot.alt])

  return (
    <li className={cn(
      'rounded border overflow-hidden bg-geo-bg',
      shot.state === 'failed' ? 'border-geo-error/50' : 'border-geo-border'
    )}>
      <div className="relative h-24 bg-geo-panel flex items-center justify-center">
        {shot.preview
          ? <img src={shot.preview} alt="" className="h-full w-full object-cover" />
          : <Loader2 className="w-4 h-4 animate-spin text-geo-muted" />}
        {isCover && shot.state === 'attached' && (
          <span className="absolute top-1 left-1 rounded bg-geo-bg/85 border border-geo-border
            px-1 py-0.5 text-[9px] text-foreground flex items-center gap-1">
            <Star className="w-2.5 h-2.5 text-geo-accent" /> Card picture
          </span>
        )}
      </div>

      <div className="px-2 py-1.5 space-y-1">
        <p className="text-[10px] text-foreground truncate" title={shot.name}>{shot.name}</p>
        <StateBadge shot={shot} />
        {shot.state !== 'preparing' && shot.bytes > 0 && (
          <p className="text-[10px] text-geo-muted">
            {shot.width}×{shot.height} · {formatBytes(shot.bytes)}
            {shot.sourceBytes && shot.sourceBytes > shot.bytes
              ? ` (from ${formatBytes(shot.sourceBytes)})`
              : ''}
          </p>
        )}
        {shot.error && <p className="text-[10px] text-geo-error leading-snug">{shot.error}</p>}

        <input
          value={alt}
          onChange={(e) => setAlt(e.target.value.slice(0, 300))}
          onBlur={() => { if (alt !== shot.alt) onAlt(alt) }}
          placeholder="Caption (optional)"
          disabled={disabled}
          className="w-full bg-geo-panel border border-geo-border rounded px-1.5 py-0.5
            text-[10px] text-foreground focus:outline-none focus:border-geo-accent
            placeholder:text-geo-muted"
        />

        <div className="flex items-center gap-1 pt-0.5">
          {shot.state === 'failed' && (
            <Button
              variant="ghost" size="sm" className="h-5 px-1 text-[10px] gap-1"
              disabled={disabled} onClick={onRetry}
            >
              <RefreshCw className="w-2.5 h-2.5" /> Retry
            </Button>
          )}
          {!isCover && shot.state === 'attached' && (
            <Button
              variant="ghost" size="sm" className="h-5 px-1 text-[10px] gap-1 text-geo-muted"
              disabled={disabled} onClick={onCover}
            >
              <Star className="w-2.5 h-2.5" /> Make card picture
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="ghost" size="sm" className="h-5 px-1 text-[10px] gap-1 text-geo-muted hover:text-geo-error"
            disabled={disabled} onClick={onRemove}
            aria-label={`Remove ${shot.name}`}
          >
            <Trash2 className="w-2.5 h-2.5" /> Remove
          </Button>
        </div>
      </div>
    </li>
  )
}
