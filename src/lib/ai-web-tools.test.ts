// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  parseDuckDuckGoHtml,
  rejectUrl,
  htmlToText,
  describeWebCall,
  WEB_TOOL_NAMES,
} from './ai-web-tools'

const ddgResult = (title: string, target: string, snippet: string) => {
  const wrapped = `//duckduckgo.com/l/?uddg=${encodeURIComponent(target)}&amp;rut=abc`
  return `
    <div class="result results_links web-result">
      <div class="links_main">
        <h2 class="result__title"><a rel="nofollow" class="result__a" href="${wrapped}">${title}</a></h2>
        <a class="result__snippet" href="${wrapped}">${snippet}</a>
      </div>
    </div>`
}

describe('parseDuckDuckGoHtml', () => {
  it('unwraps redirect links and pulls out title + snippet', () => {
    const html = `<html><body><div id="links">
      ${ddgResult('st_transform — sf', 'https://r-spatial.github.io/sf/reference/st_transform.html', 'Transform or convert coordinates')}
    </div></body></html>`
    expect(parseDuckDuckGoHtml(html, 8)).toEqual([{
      title: 'st_transform — sf',
      url: 'https://r-spatial.github.io/sf/reference/st_transform.html',
      snippet: 'Transform or convert coordinates',
    }])
  })

  it('honours the result cap and drops duplicate URLs', () => {
    const html = `<html><body>
      ${ddgResult('A', 'https://example.com/a', 'a')}
      ${ddgResult('A again', 'https://example.com/a', 'a')}
      ${ddgResult('B', 'https://example.com/b', 'b')}
      ${ddgResult('C', 'https://example.com/c', 'c')}
    </body></html>`
    expect(parseDuckDuckGoHtml(html, 2).map((r) => r.url))
      .toEqual(['https://example.com/a', 'https://example.com/b'])
  })

  it('skips non-http targets (ad/redirect junk)', () => {
    const html = `<html><body>
      <div class="result"><a class="result__a" href="javascript:void(0)">bad</a></div>
      ${ddgResult('good', 'https://cran.r-project.org/package=sf', 'ok')}
    </body></html>`
    expect(parseDuckDuckGoHtml(html, 8).map((r) => r.url))
      .toEqual(['https://cran.r-project.org/package=sf'])
  })

  it('returns nothing when the page has no results', () => {
    expect(parseDuckDuckGoHtml('<html><body><p>no results</p></body></html>', 8)).toEqual([])
  })
})

describe('rejectUrl', () => {
  it('allows public http(s) URLs', () => {
    expect(rejectUrl('https://cran.r-project.org/web/packages/sf/')).toBeNull()
    expect(rejectUrl('http://example.org/data.csv')).toBeNull()
  })

  it('rejects non-http schemes', () => {
    expect(rejectUrl('file:///etc/passwd')).toMatch(/Only http and https/)
    expect(rejectUrl('ftp://example.org/x')).toMatch(/Only http and https/)
  })

  it('rejects garbage that is not a URL', () => {
    expect(rejectUrl('not a url')).toMatch(/valid absolute URL/)
  })

  it.each([
    'http://localhost:8080/x',
    'http://127.0.0.1/x',
    'http://10.1.2.3/x',
    'http://192.168.1.5/x',
    'http://172.16.0.1/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://printer.local/status',
    'http://[::1]:9000/x',
  ])('rejects the private address %s', (url) => {
    expect(rejectUrl(url)).toMatch(/local or private-network address/)
  })

  it('does not mistake a public host for a private one', () => {
    expect(rejectUrl('https://172.32.0.1/x')).toBeNull()
    expect(rejectUrl('https://10gen.example.com/x')).toBeNull()
  })
})

describe('htmlToText', () => {
  it('strips scripts and styles and keeps block structure', () => {
    const text = htmlToText(`
      <html><head><title>sf reference</title><style>body{color:red}</style></head>
      <body><script>alert(1)</script><h1>st_area</h1><p>Compute the area.</p>
      <ul><li>x: object</li><li>...: passed on</li></ul></body></html>`)
    expect(text).not.toMatch(/alert|color:red/)
    expect(text.startsWith('sf reference')).toBe(true)
    expect(text).toContain('st_area')
    expect(text).toContain('Compute the area.')
    // list items must not run together
    expect(text).toMatch(/x: object\n/)
  })

  it('collapses runs of whitespace without joining separate blocks', () => {
    expect(htmlToText('<html><body><p>a   b</p><p>c</p></body></html>')).toBe('a b\nc')
  })
})

describe('describeWebCall', () => {
  it('renders a console line for each web tool', () => {
    expect(describeWebCall('web_search', { query: 'sf st_area' })).toBe('[AI web] search: sf st_area')
    expect(describeWebCall('web_fetch', { url: 'https://x.dev/a' })).toBe('[AI web] fetch: https://x.dev/a')
  })
})

describe('WEB_TOOL_NAMES', () => {
  it('covers exactly the tools the panel gates on the kill switch', () => {
    expect([...WEB_TOOL_NAMES].sort()).toEqual(['web_fetch', 'web_search'])
    expect(WEB_TOOL_NAMES.has('execute_r_code')).toBe(false)
  })
})
