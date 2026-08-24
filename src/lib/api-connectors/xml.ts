// Namespace-agnostic XML helpers for OGC capabilities documents (WCS/WMS).
// Servers vary in prefixing (wcs:, ows:, none), so everything matches on
// localName only.

/** Parse an XML string, throwing a readable error on parser failure. */
export function parseXml(text: string, what: string): Document {
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`Could not parse ${what} response as XML.`)
  }
  return doc
}

/** All descendant elements with the given localName (any namespace). */
export function elems(root: Document | Element, localName: string): Element[] {
  const all = root.getElementsByTagNameNS('*', localName)
  return Array.from(all)
}

/** Text content of the first DIRECT child with the given localName, if any. */
export function childText(el: Element, localName: string): string | undefined {
  for (const c of Array.from(el.children)) {
    if (c.localName === localName) return c.textContent?.trim() || undefined
  }
  return undefined
}

/** Text content of the first descendant with the given localName, if any. */
export function descText(el: Element, localName: string): string | undefined {
  return elems(el, localName)[0]?.textContent?.trim() || undefined
}

/** "lon lat" corner pair → [lon, lat] numbers, or null if malformed. */
export function parseCorner(s: string | undefined): [number, number] | null {
  const parts = (s ?? '').trim().split(/\s+/).map(Number)
  return parts.length >= 2 && parts.every(Number.isFinite) ? [parts[0], parts[1]] : null
}

/** Append query params to a base URL that may already carry a query string. */
export function withParams(baseUrl: string, params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString()
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${q}`
}
