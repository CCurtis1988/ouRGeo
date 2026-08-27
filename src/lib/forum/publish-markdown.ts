// Turn knitted markdown into something the ouRGeo forum can actually render.
//
// The forum's renderer (the site's assets/js/markdown.js) is deliberately
// tiny and structurally XSS-safe: it escapes everything the user wrote before
// emitting a single tag, so raw HTML is shown as text rather than rendered.
// Its whole vocabulary is:
//
//   headings (h1–h3), paragraphs, ul/ol, blockquote, hr, fenced and inline
//   code, bold/italic/strike, backslash escapes, pipe tables, links, and
//   images with an http(s) src.
//
// Everything here exists to land inside that vocabulary. It is a pure text
// transform with no DOM and no network, so every rule is unit-testable.

/**
 * Mirrors the site's config.js LIMITS and the CHECK constraints behind them.
 *
 * `bodyMax` is the one that moves. The authority is `threads_body_check` /
 * `posts_body_check` in the site's db/schema.sql; this copy only exists so the
 * dialog can refuse a document before knitting figures into the user's storage
 * quota. Raise it here and it must be raised in both of the other two places,
 * or the app will cheerfully post a body the database then rejects.
 */
export const FORUM_LIMITS = {
  titleMax: 140,
  bodyMax: 40000,
  imagesPerPost: 10,
}

export interface LocalImage {
  /** Path exactly as it appears in the markdown. */
  path: string
  alt: string
}

/** A local (relative) image reference — one that has to be uploaded. */
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g

/** Already a URL the forum will accept as-is. */
function isRemote(path: string): boolean {
  return /^https?:\/\//i.test(path)
}

/**
 * Local figures referenced by the document, in document order, de-duplicated.
 *
 * De-duplication matters: the same figure referenced twice is one upload and
 * one attachment, and counting it twice could push a publishable document over
 * the ten-image cap for no reason.
 */
export function collectLocalImages(md: string): LocalImage[] {
  const seen = new Set<string>()
  const out: LocalImage[] = []
  for (const m of md.matchAll(IMAGE_RE)) {
    const [, alt, path] = m
    if (isRemote(path) || path.startsWith('data:')) continue
    if (seen.has(path)) continue
    seen.add(path)
    out.push({ path, alt: alt.trim() })
  }
  return out
}

/** Replace local image paths with the uploaded URLs. Unmapped paths are left. */
export function rewriteImages(md: string, urls: Map<string, string>): string {
  return md.replace(IMAGE_RE, (whole, alt: string, path: string) => {
    const url = urls.get(path)
    return url ? `![${alt}](${url})` : whole
  })
}

// ── Tables ──────────────────────────────────────────────────────────────────
//
// Nothing to do. Pipe tables pass straight through to the forum, which renders
// them as real <table> markup — which is why the knit variant asks pandoc for
// the pipe_tables extension in the first place (electron/main/knit.ts).
//
// This used to flatten them into aligned text inside a code fence, because the
// renderer had no table rule. It does now, and a kable() of a hundred rows is
// far better as a scrolling table than as a wall of monospace.
//
// A table pandoc CANNOT express as a pipe table still arrives as raw <table>
// HTML, and stripRawHtml below removes it with a warning, as before.

// ── Code blocks ─────────────────────────────────────────────────────────────

/**
 * Close up pandoc's ``` r fences.
 *
 * The forum's fence rule is /```([A-Za-z0-9_+-]*)[ \t]*\n?/ — with a SPACE
 * between the backticks and the language it matches the language as empty and
 * then treats `r` as the first line of the code, putting a stray `r` at the top
 * of every chunk. Pandoc writes the space; we take it back out.
 */
export function normalizeFences(md: string): string {
  return md.replace(/^([ \t]*)```[ \t]+([A-Za-z0-9_+-]+)[ \t]*$/gm, '$1```$2')
}

/**
 * Convert indented code blocks to fenced ones.
 *
 * This is the one that matters most for R Markdown: knitr writes every chunk's
 * OUTPUT as a four-space indented block, and the forum's renderer has no
 * indented-code rule at all — it has a fence rule and an else-branch that makes
 * a paragraph. So a printed data frame would arrive as prose with its columns
 * collapsed and its `##` prefixes intact. Fenced, it renders as the monospace
 * block the author meant.
 */
export function indentedToFenced(md: string): { text: string; count: number } {
  const lines = md.split('\n')
  const out: string[] = []
  let inFence = false
  let count = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) { inFence = !inFence; out.push(line); continue }
    if (inFence) { out.push(line); continue }

    // A block only starts after a blank line, so an indented continuation of a
    // list item is never mistaken for code.
    const prevBlank = i === 0 || !lines[i - 1].trim()
    if (!prevBlank || !/^(?: {4}|\t)/.test(line) || !line.trim()) { out.push(line); continue }

    const block: string[] = []
    let j = i
    for (; j < lines.length; j++) {
      const l = lines[j]
      if (/^(?: {4}|\t)/.test(l)) { block.push(l.replace(/^(?: {4}|\t)/, '')); continue }
      // A blank line inside the block only continues it if more indented code
      // follows; otherwise the block has ended.
      if (!l.trim() && /^(?: {4}|\t)/.test(lines[j + 1] ?? '')) { block.push(''); continue }
      break
    }

    out.push('```', ...block, '```')
    count++
    i = j - 1
  }

  return { text: out.join('\n'), count }
}

// ── Raw HTML ────────────────────────────────────────────────────────────────

/** Block-level HTML pandoc could not express in strict markdown. */
const HTML_BLOCK_RE = /^\s*<\/?(table|div|figure|img|iframe|script|style|span|p|br|hr)\b[^>]*>/i

/**
 * Drop raw HTML lines, reporting how many went.
 *
 * The forum escapes raw HTML rather than rendering it, so leaving these in
 * would show the user tag soup in their published post. Dropping is the lesser
 * evil, and the count is surfaced in the preview so the choice is visible
 * rather than silent.
 */
export function stripRawHtml(md: string): { text: string; count: number } {
  const lines = md.split('\n')
  const out: string[] = []
  let count = 0
  let inFence = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inFence = !inFence; out.push(line); continue }
    if (!inFence && HTML_BLOCK_RE.test(line)) { count++; continue }
    out.push(line)
  }
  return { text: out.join('\n'), count }
}

// ── Whole-document preparation ──────────────────────────────────────────────

export interface PreparedPost {
  /** Body ready to post, with local image paths still in place. */
  body: string
  images: LocalImage[]
  /** Things the user should know before publishing, but which do not block it. */
  warnings: string[]
  /** Things that make the post impossible. Publishing is disabled while any exist. */
  errors: string[]
}

/** Collapse the runs of blank lines pandoc leaves behind. */
function tidy(md: string): string {
  return md.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/**
 * Prepare knitted markdown for the forum, and say what the user is losing.
 *
 * Deliberately reports rather than silently repairs where the outcome is
 * lossy: the preview shows exactly what will be posted, and publishing is a
 * one-way action from the app's side.
 */
export function preparePost(rawMarkdown: string): PreparedPost {
  const warnings: string[] = []
  const errors: string[] = []

  const fenced = indentedToFenced(normalizeFences(rawMarkdown))
  const html = stripRawHtml(fenced.text)
  if (html.count > 0) {
    warnings.push(
      `${html.count} line${html.count === 1 ? '' : 's'} of raw HTML removed — ` +
      'the forum shows HTML as text rather than rendering it.'
    )
  }

  const body = tidy(html.text)
  const images = collectLocalImages(body)

  if (images.length > FORUM_LIMITS.imagesPerPost) {
    errors.push(
      `This document has ${images.length} figures and a forum post can carry ` +
      `${FORUM_LIMITS.imagesPerPost}. Remove some, or split it into two posts.`
    )
  }

  // Length is checked against the body as it will be POSTED, so the image URLs
  // have to be accounted for — a Supabase public URL is far longer than the
  // relative path it replaces, and a document that fits before uploading could
  // fail the CHECK constraint afterwards.
  const projected = body.length + images.length * PUBLIC_URL_OVERHEAD
  if (projected > FORUM_LIMITS.bodyMax) {
    errors.push(
      `This post would be about ${projected.toLocaleString()} characters and the ` +
      `limit is ${FORUM_LIMITS.bodyMax.toLocaleString()}. Shorten the text, or ` +
      'move some of the detail into a reply.'
    )
  }

  if (!body.trim()) errors.push('The knitted document is empty — there is nothing to post.')

  if (/^#{4,}\s/m.test(body)) {
    warnings.push('Headings below level 3 will be shown as level 3 — the forum caps heading depth.')
  }

  return { body, images, warnings, errors }
}

/**
 * How much longer an uploaded URL is than the relative path it replaces.
 *
 * A Supabase public object URL is ~120 characters; the knitr path it replaces
 * is ~50. Deliberately an over-estimate, because being told a post is too long
 * before uploading anything is far better than a CHECK-constraint refusal after
 * ten images are already sitting in the user's storage quota.
 */
const PUBLIC_URL_OVERHEAD = 90

/** Default post title, from the document's front matter or its filename. */
export function defaultTitle(frontMatterTitle: string | undefined, fileName: string): string {
  const fromYaml = (frontMatterTitle ?? '').trim()
  if (fromYaml) return fromYaml.slice(0, FORUM_LIMITS.titleMax)
  return fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, FORUM_LIMITS.titleMax)
}
