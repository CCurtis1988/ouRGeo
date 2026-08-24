/**
 * Expand a snippet body containing `$N` caret markers into literal text plus a
 * final caret offset. The caret lands on `$1` when present, otherwise `$0`,
 * otherwise the end. All markers are stripped from the output.
 */
export function expandSnippet(body: string): { text: string; caret: number } {
  const target = /\$1\b/.test(body) ? '1' : '0'
  let out = ''
  let caret = -1
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '$' && /[0-9]/.test(body[i + 1] ?? '')) {
      const digit = body[i + 1]
      if (digit === target && caret < 0) caret = out.length
      i++ // skip the digit
      continue
    }
    out += body[i]
  }
  return { text: out, caret: caret < 0 ? out.length : caret }
}
