/** Conservative fallback, including non-Latin text and serialisation wrappers.
 * This is an estimate, not a tokenizer or a billing receipt. */
export function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  let latin = 0, other = 0
  for (const char of text) {
    if (char.codePointAt(0)! < 128) latin++
    else other += char.length
  }
  return Math.ceil(latin / 3 + other) + 16
}

export function boundedText(text: string, tokens: number): { text: string; complete: boolean } {
  if (estimateTokens(text) <= tokens) return { text, complete: true }
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (estimateTokens(text.slice(0, mid)) <= tokens) lo = mid
    else hi = mid - 1
  }
  // Do not leave half a surrogate pair in a tool result.
  if (lo && /[\uD800-\uDBFF]/.test(text[lo - 1])) lo--
  return { text: text.slice(0, lo), complete: false }
}

export function inputCapacity(window: number, output = 4000): number {
  return Math.max(0, window - output - Math.max(1000, Math.ceil(window * .05)))
}

export function assertInvocationBudget(payload: unknown, window: number, output = 4000): number {
  const used = estimateTokens(payload)
  if (used > inputCapacity(window, output)) {
    throw new Error('BUDGET_LIMIT: this request does not fit the selected context window. Start a shorter conversation, select a smaller attachment or choose a larger-window model; your original messages are retained.')
  }
  return used
}
