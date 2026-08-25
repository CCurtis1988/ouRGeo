// YAML front matter handling.
//
// Front matter never enters ProseMirror. Milkdown's schema has no node for it,
// so a round trip would either mangle it or drop it outright — and it carries
// the document's knit configuration, which is exactly the content a user would
// least forgive losing. It is split off before parsing and re-attached verbatim.

export interface SplitDocument {
  /** The `---\n…\n---` block including its delimiters, or '' when absent. */
  frontMatter: string
  /** Everything after it. */
  body: string
  /** Line count of the front matter, for mapping positions back. */
  frontMatterLines: number
}

const OPEN = /^---[ \t]*\r?\n/

/**
 * Split leading YAML front matter from the document body.
 *
 * Only a block at the very start counts — a `---` later in the document is a
 * horizontal rule, and treating it as front matter would swallow the document.
 */
export function splitFrontMatter(text: string): SplitDocument {
  if (!OPEN.test(text)) return { frontMatter: '', body: text, frontMatterLines: 0 }

  const lines = text.split('\n')
  // Find the closing fence, which must be its own line.
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)[ \t]*\r?$/.test(lines[i]) || /^(---|\.\.\.)[ \t]*$/.test(lines[i])) {
      const frontMatter = lines.slice(0, i + 1).join('\n')
      // Drop exactly one blank separator line so re-joining is lossless.
      const bodyStart = i + 1
      return {
        frontMatter,
        body: lines.slice(bodyStart).join('\n'),
        frontMatterLines: i + 1,
      }
    }
  }
  // Unterminated: treat the whole thing as body rather than eating the document.
  return { frontMatter: '', body: text, frontMatterLines: 0 }
}

/**
 * Re-attach front matter to a (possibly rewritten) body.
 *
 * `frontMatter` never carries its trailing newline (it ends at the closing
 * `---`) and `body` begins at the character after it, so exactly one newline
 * belongs between them. Adding it conditionally swallows the blank separator
 * line that was in the original file.
 *
 * A body that has been REWRITTEN — by Visual mode — has lost that leading blank
 * line, because no markdown serializer emits one. Restore it, or every trip
 * through Visual mode would shift the whole document up by a line.
 */
export function joinFrontMatter(frontMatter: string, body: string): string {
  if (!frontMatter) return body
  const gap = body === '' || body.startsWith('\n') ? '\n' : '\n\n'
  return frontMatter + gap + body
}

/** Read a handful of top-level scalar keys. Deliberately not a YAML parser —
 *  we only display title/output, and never rewrite the block. */
export function readFrontMatterKeys(frontMatter: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of frontMatter.split('\n')) {
    const m = /^([A-Za-z_][\w-]*):[ \t]+(.*)$/.exec(line)
    if (!m) continue
    out[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1')
  }
  return out
}
