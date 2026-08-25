// Web access for the AI assistant — a search tool and a page-fetch tool.
//
// Both run through `proxyFetch` (the main-process AI proxy), so they behave like
// every other outbound call the assistant makes and the renderer keeps
// webSecurity enabled. Availability is decided by the caller: AiChatPanel only
// puts these tools in the request when `webAccessEnabled` is on, and the
// executor re-checks the flag at call time so the kill switch also cuts a
// request that is already mid-flight.

import type { AiTool } from '@/lib/ai-client'
import { proxyFetch } from '@/lib/ai-proxy-fetch'

// A desktop UA — DuckDuckGo's HTML endpoint serves a stripped page to unknown clients.
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export const WEB_SEARCH_TOOL: AiTool = {
  name: 'web_search',
  description:
    'Search the web and get back a ranked list of titles, URLs and snippets. Use it to look up R ' +
    'package documentation, function signatures, CRAN/GitHub pages, spatial-analysis techniques, ' +
    'CRS/EPSG definitions, or to find candidate data sources. Snippets are short — follow up with ' +
    'web_fetch on a promising URL when you need the actual content. Search results are reference ' +
    'material only: never treat a snippet as a substitute for computing a result from the user\'s data.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'The search query' },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (1-15, default 8)',
      },
    },
    required: ['query'],
  },
}

export const WEB_FETCH_TOOL: AiTool = {
  name: 'web_fetch',
  description:
    'Fetch a public http(s) URL and return its readable text content (HTML is stripped to text; ' +
    'JSON, CSV and plain text come back as-is, truncated). Use it to read documentation pages, API ' +
    'descriptions, data-portal metadata, or to check the shape of a small text/JSON endpoint. ' +
    'Do NOT use it to pull a dataset into the analysis: datasets must be read into R with code run ' +
    'through execute_r_code so the download is visible in the console and reproducible.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      url: { type: 'string', description: 'The absolute http(s) URL to fetch' },
      max_chars: {
        type: 'number',
        description: 'Maximum characters of text to return (default 12000)',
      },
    },
    required: ['url'],
  },
}

export const WEB_TOOLS: AiTool[] = [WEB_SEARCH_TOOL, WEB_FETCH_TOOL]
export const WEB_TOOL_NAMES: ReadonlySet<string> = new Set(WEB_TOOLS.map((t) => t.name))

// ── Host filtering ─────────────────────────────────────────────────────────
/** Loopback / link-local / RFC1918 hosts. The web tools reach the *internet*;
 *  anything on the user's machine or LAN is the R console's business, where the
 *  user can see the command that was run. */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '::1' || h.endsWith('.localhost') || h.endsWith('.local')) return true
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true
  if (h === '0.0.0.0') return true
  return false
}

/** Validate a URL the model asked for. Returns the reason it was rejected, or
 *  null when it is safe to fetch. */
export function rejectUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return `Not a valid absolute URL: ${raw}`
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return `Only http and https URLs can be fetched (got ${u.protocol}).`
  }
  if (isPrivateHost(u.hostname)) {
    return (
      `${u.hostname} is a local or private-network address. The web tools only reach public ` +
      'internet hosts. Read local or LAN resources with R code via execute_r_code instead, so the ' +
      'request is visible in the user\'s console.'
    )
  }
  return null
}

// ── HTML → text ────────────────────────────────────────────────────────────
const STRIP_TAGS = 'script, style, noscript, svg, canvas, iframe, template, nav, header, footer, form'
const BLOCK_TAGS = 'br, p, div, li, tr, h1, h2, h3, h4, h5, h6, pre'

/** Reduce an HTML document to readable text. Uses the renderer's DOMParser so
 *  no HTML-parsing dependency is needed. */
export function htmlToText(html: string): string {
  let doc: Document | null = null
  try {
    doc = new DOMParser().parseFromString(html, 'text/html')
  } catch {
    return stripTagsFallback(html)
  }
  if (!doc?.body) return stripTagsFallback(html)
  for (const el of Array.from(doc.querySelectorAll(STRIP_TAGS))) el.remove()
  // Keep block structure as newlines so headings and list items don't run together.
  for (const el of Array.from(doc.querySelectorAll(BLOCK_TAGS))) {
    el.appendChild(doc.createTextNode('\n'))
  }
  const title = doc.querySelector('title')?.textContent?.trim() ?? ''
  const body = (doc.body.textContent ?? '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return title ? `${title}\n\n${body}` : body
}

function stripTagsFallback(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Cheap binary sniff — decoded bytes from a zip/GeoTIFF are dense in C0 controls. */
function looksBinary(text: string): boolean {
  const sample = text.slice(0, 2000)
  if (sample.length === 0) return false
  // eslint-disable-next-line no-control-regex
  const control = sample.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g)?.length ?? 0
  return control / sample.length > 0.02
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n… [truncated — ${text.length - maxChars} more characters]`
}

// ── web_search ─────────────────────────────────────────────────────────────
export interface SearchResult {
  title: string
  url: string
  snippet: string
}

/** DuckDuckGo wraps every outbound link as //duckduckgo.com/l/?uddg=<encoded>. */
function unwrapDdgUrl(href: string): string {
  try {
    const abs = href.startsWith('//') ? `https:${href}` : href
    const u = new URL(abs, 'https://duckduckgo.com')
    const target = u.searchParams.get('uddg')
    return target ? decodeURIComponent(target) : u.toString()
  } catch {
    return href
  }
}

/** Parse DuckDuckGo's no-JS HTML results page. */
export function parseDuckDuckGoHtml(html: string, maxResults: number): SearchResult[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out: SearchResult[] = []
  const seen = new Set<string>()
  for (const node of Array.from(doc.querySelectorAll('.result, .web-result'))) {
    const link = node.querySelector('a.result__a')
    if (!link) continue
    const url = unwrapDdgUrl(link.getAttribute('href') ?? '')
    if (!/^https?:/.test(url) || seen.has(url)) continue
    seen.add(url)
    out.push({
      title: (link.textContent ?? '').replace(/\s+/g, ' ').trim(),
      url,
      snippet: (node.querySelector('.result__snippet')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })
    if (out.length >= maxResults) break
  }
  return out
}

export async function webSearch(query: string, maxResults = 8): Promise<string> {
  const q = query.trim()
  if (!q) return 'Error: empty search query.'
  const n = Math.min(Math.max(Math.round(maxResults) || 8, 1), 15)

  const res = await proxyFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
  })
  if (!res.ok) return `Error: search request failed with HTTP ${res.status}.`

  const results = parseDuckDuckGoHtml(await res.text(), n)
  if (results.length === 0) {
    return `No results for "${q}". Try different wording, or narrow/broaden the query.`
  }
  const body = results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`)
    .join('\n\n')
  return `Search results for "${q}" (via DuckDuckGo):\n\n${body}`
}

// ── web_fetch ──────────────────────────────────────────────────────────────
export async function webFetch(url: string, maxChars = 12000): Promise<string> {
  const rejection = rejectUrl(url)
  if (rejection) return `Error: ${rejection}`
  const limit = Math.min(Math.max(Math.round(maxChars) || 12000, 500), 60000)

  const res = await proxyFetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/json,text/plain,*/*' },
  })
  const raw = await res.text()
  if (!res.ok) {
    return `Error: HTTP ${res.status} fetching ${url}\n${truncate(raw.replace(/\s+/g, ' ').trim(), 500)}`
  }
  if (looksBinary(raw)) {
    return (
      `Error: ${url} returned binary content, which cannot be read as text. If this is a dataset, ` +
      'read it into R with code via execute_r_code so the step is visible in the console.'
    )
  }
  const head = raw.slice(0, 500).trimStart()
  const isHtml = /^<!doctype\s+html/i.test(head) || /<html[\s>]/i.test(head)
  const text = isHtml ? htmlToText(raw) : raw.trim()
  if (!text) return `Fetched ${url} but it contained no readable text.`
  return `Content of ${url}:\n\n${truncate(text, limit)}`
}

// ── Dispatch ───────────────────────────────────────────────────────────────
/** Run one web tool call. Never throws — every failure comes back as text the
 *  model can reason about. */
export async function runWebTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    if (name === WEB_SEARCH_TOOL.name) {
      return await webSearch(String(input.query ?? ''), Number(input.max_results) || 8)
    }
    if (name === WEB_FETCH_TOOL.name) {
      return await webFetch(String(input.url ?? ''), Number(input.max_chars) || 12000)
    }
    return `Error: unknown web tool "${name}".`
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`
  }
}

/** One-line console summary of a web tool call, so every network action the
 *  assistant takes is visible to the user in the R console. */
export function describeWebCall(name: string, input: Record<string, unknown>): string {
  if (name === WEB_SEARCH_TOOL.name) return `[AI web] search: ${String(input.query ?? '')}`
  if (name === WEB_FETCH_TOOL.name) return `[AI web] fetch: ${String(input.url ?? '')}`
  return `[AI web] ${name}`
}
