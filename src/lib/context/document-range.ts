import type { DocumentRange } from './types'

/** Locate line boundaries in the existing editor string. Splitting a large
 * buffer builds an array and duplicates every line for a tiny selected span. */
export function readDocumentRange(text: string, range: DocumentRange): string {
  if (!Number.isSafeInteger(range.startLine) || !Number.isSafeInteger(range.endLine) || range.startLine < 1 || range.endLine < range.startLine) throw new Error('SOURCE_UNAVAILABLE: choose a valid document line range.')
  let start = 0
  for (let line = 1; line < range.startLine; line++) {
    const next = text.indexOf('\n', start)
    if (next < 0) throw new Error('SOURCE_UNAVAILABLE: the selected start line is beyond this document. Choose a current range.')
    start = next + 1
  }
  let end = start
  for (let line = range.startLine; line <= range.endLine; line++) {
    const next = text.indexOf('\n', end)
    if (next < 0 || line === range.endLine) { end = next < 0 ? text.length : next; break }
    end = next + 1
    if (end - start > 1_000_000) throw new Error('BUDGET_LIMIT: the selected document span exceeds 1 MB. Choose fewer lines; the whole document was not copied.')
  }
  if (end - start > 1_000_000) throw new Error('BUDGET_LIMIT: the selected document span exceeds 1 MB. Choose fewer lines; the whole document was not copied.')
  // A range starting inside a private-key block must not bypass full-document
  // redaction merely because its BEGIN marker was on an earlier line.
  const privateKeys = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
  let at = start
  const pieces: string[] = []
  let match: RegExpExecArray | null
  while ((match = privateKeys.exec(text)) && match.index < end) {
    const closing = /-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
    closing.lastIndex = match.index + match[0].length
    const finish = closing.exec(text)
    const blockEnd = finish ? finish.index + finish[0].length : text.length
    if (blockEnd <= start) continue
    pieces.push(text.slice(at, Math.max(at, match.index)), '[redacted private key]')
    at = Math.min(end, blockEnd)
    privateKeys.lastIndex = blockEnd
    if (at >= end) break
  }
  pieces.push(text.slice(at, end))
  return pieces.join('')
}
