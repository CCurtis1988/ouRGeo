// What a pick of image files means, and what the panel says about it.
//
// Pure, so the two decisions that are easy to get quietly wrong — which of a
// multi-selection are usable, and what the panel's one-line summary claims — can
// be held to a test with no dialog, no canvas and no network.
//
// The rule behind all of it: an author who has just chosen five files must be
// able to read, without counting thumbnails, how many of them the store now
// holds. Silence is what the old panel offered, and silence is indistinguishable
// from refusal.

/**
 * How many screenshots one plugin may carry from here.
 *
 * Not a server rule — `plugin_media` has no per-plugin cap, only a 200-object
 * storage policy per account — so it is stated as ouRGeo's own limit wherever
 * it bites, never as a refusal from ourgeo.dev. Eight is what a store page can
 * show without becoming a scroll.
 */
export const MAX_SCREENSHOTS = 8

/** Extensions the picker offers and `createImageBitmap` decodes. */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
}

/** Last path segment, for either separator. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/**
 * The MIME type to decode a file as, from its name.
 *
 * Worth being right about rather than defaulting everything to `image/png`:
 * the blob's declared type is what `createImageBitmap` is handed, and a decoder
 * given the wrong one is a failure with no message a user can act on.
 */
export function mimeForName(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return MIME_BY_EXT[ext] ?? null
}

export interface AcceptedFile {
  path: string
  name: string
  mime: string
}

export interface RejectedFile {
  name: string
  reason: string
}

export interface AddPlan {
  accepted: AcceptedFile[]
  rejected: RejectedFile[]
}

/**
 * Split a multi-selection into what will be added and what will not.
 *
 * Both halves are returned because the panel reports both. A file silently
 * dropped for being a PDF, or for being the ninth, is the exact failure this
 * whole change exists to remove.
 */
export function planScreenshotAdd(
  paths: string[],
  existing: number,
  max: number = MAX_SCREENSHOTS,
): AddPlan {
  const accepted: AcceptedFile[] = []
  const rejected: RejectedFile[] = []
  let room = Math.max(0, max - existing)

  for (const path of paths) {
    const name = baseName(path)
    const mime = mimeForName(name)
    if (!mime) {
      rejected.push({ name, reason: 'not an image ouRGeo can read' })
      continue
    }
    if (room === 0) {
      rejected.push({ name, reason: `over the limit of ${max}` })
      continue
    }
    accepted.push({ path, name, mime })
    room--
  }

  return { accepted, rejected }
}

/** One sentence naming what was left out, or null when nothing was. */
export function describeRejected(rejected: RejectedFile[]): string | null {
  if (rejected.length === 0) return null
  const named = rejected.slice(0, 3).map((r) => `${r.name} (${r.reason})`).join(', ')
  const rest = rejected.length > 3 ? `, and ${rejected.length - 3} more` : ''
  return `Not added: ${named}${rest}.`
}

export type ScreenshotState =
  /** Being read, resized and re-encoded on this machine. */
  | 'preparing'
  /** Ready, but the store has no plugin row to attach it to until a submission. */
  | 'waiting'
  | 'uploading'
  /** On the store page. This is the only state that means "the store has it". */
  | 'attached'
  | 'failed'

/**
 * The status line above the thumbnails.
 *
 * Deliberately counts states rather than files, and deliberately names
 * `waiting` in full: "will upload when you submit" is the one state an author
 * could otherwise mistake for "attached", and the difference is whether
 * anything is on the server at all.
 */
export function summarizeScreenshots(states: ScreenshotState[]): string {
  if (states.length === 0) return 'No screenshots yet.'

  const count = (s: ScreenshotState): number => states.filter((x) => x === s).length
  const attached = count('attached')
  const busy = count('preparing') + count('uploading')
  const waiting = count('waiting')
  const failed = count('failed')

  const parts: string[] = []
  if (attached) parts.push(`${attached} on your store page`)
  if (busy) parts.push(`${busy} uploading`)
  if (waiting) parts.push(`${waiting} will upload when you submit`)
  if (failed) parts.push(`${failed} failed`)
  return parts.join(' · ')
}

/** `1.2 MB`, `180 KB`. Sizes are shown so "resized before upload" is visible. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
