import { readFile, stat } from 'node:fs/promises'
import { posix } from 'node:path'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { fromBuffer, type Entry, type ZipFile } from 'yauzl'
import { format as formatNumber, getFormatDateInfo } from 'numfmt'
import type { ProjectFileExtraction, ProjectFileSection } from '../../../src/lib/project-files'

export const EXTRACTION_VERSION = 'project-files-1'
export const EXTRACTION_LIMITS = { original: 100 * 1024 ** 2, text: 20 * 1024 ** 2, officeExpanded: 256 * 1024 ** 2, xmlPart: 32 * 1024 ** 2, officeEntries: 10_000, pages: 2000, cells: 100_000 } as const
export interface ExtractionOptions { includeHidden?: boolean }

type XmlNode = { [key: string]: XmlNode[] | string | Record<string, string> }
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false, trimValues: false, processEntities: false })
const tag = (node: XmlNode): string => Object.keys(node).find(key => key !== ':@') || ''
const children = (node: XmlNode): XmlNode[] => { const value = node[tag(node)]; return Array.isArray(value) ? value : [] }
const attrs = (node?: XmlNode): Record<string, string> => Object.fromEntries(Object.entries(node?.[':@'] as Record<string, string> || {}).map(([name, value]) => [name, decodeEntities(value)]))
const direct = (node: XmlNode, name: string): XmlNode[] => children(node).filter(child => tag(child) === name)
const descendants = (nodes: XmlNode[], name: string): XmlNode[] => {
  const found: XmlNode[] = []
  const visit = (items: XmlNode[], depth: number): void => {
    if (depth > 120) throw new Error('Document nesting exceeds the supported limit. Export a simpler copy and reimport it.')
    for (const node of items) { if (tag(node) === name) found.push(node); visit(children(node), depth + 1) }
  }
  visit(nodes, 0); return found
}
const decodeEntities = (value: string): string => value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
  const known: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }
  if (known[entity]) return known[entity]
  const n = entity.startsWith('&#x') ? Number.parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1))
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '\ufffd'
})
function textOf(node: XmlNode): string {
  if (tag(node) === '#text') return decodeEntities(String(node['#text']))
  if (['del', 'delText', 'instrText'].includes(tag(node))) return ''
  if (tag(node) === 'tab') return '\t'
  if (['br', 'cr'].includes(tag(node))) return '\n'
  return children(node).map(textOf).join('')
}
function xml(value: Buffer | undefined): XmlNode[] {
  if (!value) return []
  const source = utf8(value)
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Document contains unsupported XML declarations. Export a clean copy and reimport it.')
  if (XMLValidator.validate(source) !== true) throw new Error('Document XML is damaged. Export a repaired copy and reimport it.')
  return parser.parse(source) as XmlNode[]
}
function utf8(bytes: Buffer): string {
  // Guessing an encoding can turn leading zeros or identifiers into different
  // evidence. Conversion must be an explicit user action.
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
}
const result = (status: ProjectFileExtraction['status'], description: string, coverage: string, sections: ProjectFileSection[] = [], issue?: string): ProjectFileExtraction => ({ version: EXTRACTION_VERSION, status, description, coverage, sections, ...(issue ? { issue } : {}) })
class Sections {
  readonly items: ProjectFileSection[] = []
  bytes = 0
  truncated = false
  add(section: ProjectFileSection): boolean {
    const size = Buffer.byteLength(section.text)
    if (size + this.bytes > EXTRACTION_LIMITS.text) { this.truncated = true; return false }
    this.bytes += size; this.items.push(section); return true
  }
}

// Read every entry through a counted stream: central-directory sizes alone do
// not constrain a malicious Office archive's actual inflation. No part is ever
// extracted to a path, and relationships are only interpreted as internal IDs.
export async function readOfficeParts(bytes: Buffer): Promise<Map<string, Buffer>> {
  const zip = await new Promise<ZipFile>((resolve, reject) => fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, archive) => error || !archive ? reject(error || new Error('Cannot open Office archive')) : resolve(archive)))
  return new Promise((resolve, reject) => {
    const parts = new Map<string, Buffer>(), seen = new Map<string, boolean>()
    let total = 0, count = 0, failed = false
    const fail = (error: unknown): void => { if (!failed) { failed = true; zip.close(); reject(error) } }
    zip.on('error', fail)
    zip.on('end', () => resolve(parts))
    zip.on('entry', (entry: Entry) => {
      const name = entry.fileName
      const canonical = name.replace(/\/$/, '')
      const folded = canonical.toLowerCase(), isDirectory = name.endsWith('/')
      const mode = entry.externalFileAttributes >>> 16
      const pathParts = folded.split('/')
      const conflictingParent = pathParts.slice(0, -1).some((_, index) => seen.get(pathParts.slice(0, index + 1).join('/')) === false)
      const conflictingChild = !isDirectory && [...seen.keys()].some(path => path.startsWith(`${folded}/`))
      if (++count > EXTRACTION_LIMITS.officeEntries || !canonical || canonical.startsWith('/') || canonical.includes('\\') || /^[A-Za-z]:/.test(canonical) || canonical.split('/').some(p => p === '.' || p === '..' || p === '') || seen.has(folded) || conflictingParent || conflictingChild || (mode & 0xf000) === 0xa000) { fail(new Error('Office archive has unsafe or conflicting entries. Export a clean copy and reimport it.')); return }
      seen.set(folded, isDirectory)
      if (entry.generalPurposeBitFlag & 1) { fail(new Error('Password-protected Office archive')); return }
      if (isDirectory) { zip.readEntry(); return }
      if (entry.uncompressedSize > EXTRACTION_LIMITS.officeExpanded) { fail(new Error('Office archive exceeds the expansion limit.')); return }
      const keep = /^(word|xl)\/.*\.(xml|rels)$/.test(name)
      if (keep && entry.uncompressedSize > EXTRACTION_LIMITS.xmlPart) { fail(new Error('Office XML part exceeds the extraction limit.')); return }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) { fail(error || new Error('Cannot read Office archive')); return }
        let size = 0
        const chunks: Buffer[] = []
        stream.on('error', fail)
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length; total += chunk.length
          if (total > EXTRACTION_LIMITS.officeExpanded || (keep && size > EXTRACTION_LIMITS.xmlPart)) { stream.destroy(); fail(new Error('Office archive exceeds the actual expansion limit.')); return }
          if (keep) chunks.push(chunk)
        })
        stream.on('end', () => { if (failed) return; if (keep) parts.set(name, Buffer.concat(chunks)); zip.readEntry() })
      })
    })
    zip.readEntry()
  })
}

function extractText(bytes: Buffer, name: string): ProjectFileExtraction {
  const text = utf8(bytes)
  if (text.includes('\0')) return result('stored', 'Binary or unsupported text encoding.', 'No text indexed.', [], 'Convert this file to UTF-8 text and reimport it.')
  const lines = text.split(/\r?\n/), sections = new Sections()
  for (let start = 0; start < lines.length; start += 80) {
    const end = Math.min(start + 80, lines.length)
    // A single enormous line must still be bounded; retain an honest partial
    // state instead of implying its unseen suffix was searched.
    const full = lines.slice(start, end).join('\n')
    if (!sections.add({ title: `${name}, lines ${start + 1}–${end}`, location: { kind: 'lines', start: start + 1, end }, text: full })) break
  }
  const headings = lines.filter(line => /^#{1,6}\s/.test(line)).slice(0, 4).map(line => line.replace(/^#+\s*/, '')).join('; ')
  return result(sections.truncated ? 'partial' : 'searchable', `UTF-8 text, ${lines.length} lines.${headings ? ` Headings: ${headings.slice(0, 280)}.` : ''}`, `${sections.items.at(-1)?.location.kind === 'lines' ? (sections.items.at(-1)!.location as { end: number }).end : 0} of ${lines.length} lines indexed.${sections.truncated ? ' Text extraction limit reached.' : ''}`, sections.items)
}

function extractDelimited(bytes: Buffer, delimiter: string): ProjectFileExtraction {
  const source = utf8(bytes), sections = new Sections()
  let field = '', row: string[] = [], quoted = false, line = 1, startLine = 1, count = 0, cells = 0
  const flush = (): boolean => {
    row.push(field); field = ''; count++; cells += row.length
    const values = row.map((value, i) => `${i + 1}: ${JSON.stringify(value)}`).join(' | ')
    const accepted = cells <= EXTRACTION_LIMITS.cells && sections.add({ title: `Row ${count}`, location: { kind: 'lines', start: startLine, end: line }, text: `Row ${count}: ${values}` })
    if (!accepted) sections.truncated = true
    row = []; startLine = line + 1; return accepted
  }
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { field += '"'; i++ } else if (quoted || !field) quoted = !quoted
      else field += char
    } else if (char === delimiter && !quoted) { row.push(field); field = '' }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i++
      if (!flush()) break
      line++
    } else { field += char; if (char === '\n') line++ }
  }
  if (!sections.truncated && (field || row.length)) flush()
  return result(quoted || sections.truncated ? 'partial' : 'searchable', `UTF-8 ${delimiter === '\t' ? 'TSV' : 'CSV'}; fields preserved as strings.`, `${sections.items.length} rows indexed; delimiter ${delimiter === '\t' ? 'tab' : 'comma'}. No date or number conversion.${quoted ? ' Unterminated quoted field.' : ''}${sections.truncated ? ' Cell or text limit reached.' : ''}`, sections.items)
}

function extractDocx(parts: Map<string, Buffer>): ProjectFileExtraction {
  if (!parts.has('word/document.xml')) throw new Error('DOCX is missing its document. Export a repaired copy and reimport it.')
  const nodes = xml(parts.get('word/document.xml')), body = descendants(nodes, 'body')[0]
  if (!body) throw new Error('DOCX document body is missing.')
  const sections = new Sections()
  let index = 0, paragraph = 0, table = 0, hidden = 0
  // Revision deletions and hidden runs are excluded before summaries/search.
  const visibleText = (node: XmlNode): string => {
    if (tag(node) === 'del' || (tag(node) === 'r' && descendants(children(node), 'vanish').some(item => attrs(item).val !== '0' && attrs(item).val !== 'false'))) { hidden++; return '' }
    if (['#text', 'tab', 'br', 'cr'].includes(tag(node))) return textOf(node)
    if (['instrText', 'delText'].includes(tag(node))) return ''
    return children(node).map(visibleText).join('')
  }
  for (const node of children(body)) {
    let text = '', title = ''
    if (tag(node) === 'p') {
      paragraph++; text = visibleText(node)
      const style = descendants(children(node), 'pStyle')[0]
      const heading = attrs(style).val?.match(/^Heading(\d+)$/i)
      title = heading ? `Heading ${heading[1]}: ${text.slice(0, 100)}` : `Paragraph ${paragraph}`
      if (descendants(children(node), 'numPr').length) text = `• ${text}`
    } else if (tag(node) === 'tbl') {
      table++; title = `Table ${table}`
      text = direct(node, 'tr').map((row, r) => direct(row, 'tc').map((cell, c) => `R${r + 1}C${c + 1}: ${direct(cell, 'p').map(visibleText).join('\n')}`).join(' | ')).join('\n')
    } else if (tag(node) !== 'sectPr') { continue }
    if (text.trim() && !sections.add({ title, location: { kind: 'docx', section: ++index }, text })) break
  }
  const omitted = [...parts.keys()].some(name => /word\/(?:header|footer|footnotes|endnotes|comments|embeddings)/.test(name)) || descendants(nodes, 'drawing').length > 0 || children(body).some(n => !['p', 'tbl', 'sectPr'].includes(tag(n)))
  const coverage = `${sections.items.length} document blocks indexed (${paragraph} paragraphs, ${table} tables visited). Structural locations; Word pagination is unavailable.${hidden ? ' Hidden/deleted runs excluded.' : ''}${omitted ? ' Headers, footers, notes, embedded objects or unsupported structures omitted.' : ''}${sections.truncated ? ' Text limit reached.' : ''}`
  return result(omitted || sections.truncated ? 'partial' : 'searchable', `DOCX with ${paragraph} paragraphs and ${table} tables.`, coverage, sections.items)
}

const builtinFormats: Record<number, string> = { 0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??', 14: 'mm-dd-yy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yy h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@' }
const truth = (value?: string): boolean => value === '1' || value === 'true'
function columnNumber(address: string): number {
  let value = 0
  for (const char of address.replace(/\d/g, '').toUpperCase()) value = value * 26 + char.charCodeAt(0) - 64
  return value
}
function extractXlsx(parts: Map<string, Buffer>, options: ExtractionOptions): ProjectFileExtraction {
  if (!parts.has('xl/workbook.xml')) throw new Error('XLSX is missing its workbook. Export a repaired copy and reimport it.')
  const workbook = xml(parts.get('xl/workbook.xml')), sheets = descendants(workbook, 'sheet'), relationships = descendants(xml(parts.get('xl/_rels/workbook.xml.rels')), 'Relationship')
  const shared = descendants(xml(parts.get('xl/sharedStrings.xml')), 'si').map(node => textOf(node))
  const styles = xml(parts.get('xl/styles.xml')), formats = new Map(Object.entries(builtinFormats).map(([id, code]) => [Number(id), code]))
  for (const node of descendants(styles, 'numFmt')) formats.set(Number(attrs(node).numFmtId), attrs(node).formatCode)
  const cellXfs = descendants(styles, 'cellXfs')[0], xfs = cellXfs ? direct(cellXfs, 'xf') : []
  const date1904 = truth(attrs(descendants(workbook, 'workbookPr')[0]).date1904)
  const sections = new Sections()
  let count = 0, hiddenSheets = 0, hiddenCells = 0, unsupportedFormats = false, visitedSheets = 0, omitted = false
  for (const sheet of sheets) {
    const attribute = attrs(sheet), name = attribute.name || 'Unnamed sheet'
    if (attribute.state === 'hidden' || attribute.state === 'veryHidden') { hiddenSheets++; if (!options.includeHidden) continue }
    const relation = relationships.find(node => attrs(node).Id === attribute.id)
    const target = attrs(relation).Target
    if (!target || attrs(relation).TargetMode === 'External') { omitted = true; continue }
    const path = posix.normalize(target.startsWith('/') ? target.slice(1) : posix.join('xl', target))
    if (!path.startsWith('xl/') || !parts.has(path)) { omitted = true; continue }
    const sheetXml = xml(parts.get(path)), hiddenColumns = descendants(sheetXml, 'col').filter(col => truth(attrs(col).hidden)).map(col => [Number(attrs(col).min), Number(attrs(col).max)])
    const merges = descendants(sheetXml, 'mergeCell').map(node => attrs(node).ref).filter(Boolean)
    visitedSheets++
    sections.add({ title: `${name}: structure`, location: { kind: 'sheet', sheet: name }, text: `Sheet ${JSON.stringify(name)}; date system ${date1904 ? '1904' : '1900'}. Stored cells are listed explicitly; absent addresses are missing cells, while blank stored cells have type blank. Merged ranges: ${merges.join(', ') || 'none'}. Formula results are cached and may be stale; formulas are never recalculated.` })
    for (const row of descendants(sheetXml, 'row')) {
      for (const cell of direct(row, 'c')) {
        const a = attrs(cell), address = a.r
        if (!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(address || '')) { omitted = true; continue }
        if (truth(attrs(row).hidden) || hiddenColumns.some(([min, max]) => columnNumber(address) >= min && columnNumber(address) <= max)) { hiddenCells++; if (!options.includeHidden) continue }
        if (++count > EXTRACTION_LIMITS.cells) { sections.truncated = true; break }
        const valueNode = direct(cell, 'v')[0], inline = direct(cell, 'is')[0], formulaNode = direct(cell, 'f')[0]
        const raw = valueNode ? textOf(valueNode) : inline ? textOf(inline) : ''
        const type = a.t || (raw === '' && !formulaNode ? 'blank' : 'n')
        const stringValue = type === 's' ? shared[Number(raw)] : type === 'inlineStr' ? textOf(inline!) : raw
        const formatId = Number(attrs(xfs[Number(a.s || 0)]).numFmtId || 0), format = formats.get(formatId)
        let displayed = stringValue ?? '[invalid shared string]'
        if (type === 'n' && raw !== '') {
          if (!format) { unsupportedFormats = true; displayed = `[display unavailable for format ${formatId}]` }
          else try {
            const dateInfo = getFormatDateInfo(format)
            const dateOffset = date1904 && (dateInfo.year || dateInfo.month || dateInfo.day) ? 1462 : 0
            displayed = formatNumber(format, Number(raw) + dateOffset)
          } catch { unsupportedFormats = true; displayed = '[display unavailable]' }
        } else if (type === 'b') displayed = raw === '1' ? 'TRUE' : 'FALSE'
        const formula = formulaNode ? textOf(formulaNode) : undefined
        const text = `${address}: ${JSON.stringify({ type, raw, value: stringValue, displayed, numberFormat: format || `unknown:${formatId}`, ...(formulaNode ? { formula, formulaAttributes: attrs(formulaNode), cachedResult: raw || null, warning: 'Cached result may be stale; no recalculation.' } : {}) })}`
        if (!sections.add({ title: `${name}!${address}`, location: { kind: 'sheet', sheet: name, range: address }, text })) break
      }
      if (sections.truncated) break
    }
    if (sections.truncated) break
  }
  const coverage = `${Math.min(count, EXTRACTION_LIMITS.cells)} ${options.includeHidden ? 'selected' : 'visible'} stored cells indexed across ${visitedSheets} of ${options.includeHidden ? sheets.length : sheets.length - hiddenSheets} ${options.includeHidden ? 'selected' : 'visible'} sheets; ${hiddenSheets} hidden sheets and ${hiddenCells} hidden cells ${options.includeHidden ? 'explicitly included' : 'excluded'}. Date system ${date1904 ? '1904' : '1900'}; blank and missing cells distinguished. Cached formula results may be stale.${sections.truncated ? ' Cell or text limit reached.' : ''}${unsupportedFormats ? ' Some displayed formats unavailable; raw values retained.' : ''}${omitted ? ' Some sheet structures unavailable.' : ''}`
  return result(sections.truncated || unsupportedFormats || omitted ? 'partial' : 'searchable', `XLSX with ${sheets.length - hiddenSheets} visible sheets and ${Math.min(count, EXTRACTION_LIMITS.cells)} indexed cells.`, coverage, sections.items)
}

function imageDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const kind = bytes.toString('ascii', 12, 16)
    if (kind === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
    if (kind === 'VP8 ' && bytes.length >= 30 && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
    if (kind === 'VP8L' && bytes[20] === 0x2f) { const bits = bytes.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 } }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) break
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xd9 || marker === 0xda) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      const size = bytes.readUInt16BE(offset)
      if (size < 2 || offset + size > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 7) return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
      offset += size
    }
  }
  return undefined
}

async function extractPdf(bytes: Buffer): Promise<ProjectFileExtraction> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // PDF.js 6 removed its eval-based font path altogether. No URL, CMap/font
  // directory or external relationship is supplied to this byte-only adapter.
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false, disableFontFace: true, useWasm: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, stopAtErrors: true })
  try {
    const doc = await task.promise, sections = new Sections(), labels = await doc.getPageLabels()
    let empty = 0, visited = 0
    for (let page = 1; page <= Math.min(doc.numPages, EXTRACTION_LIMITS.pages); page++) {
      const pdfPage = await doc.getPage(page), content = await pdfPage.getTextContent()
      let text = ''
      for (const item of content.items) if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ')
      visited++
      if (!text.trim()) empty++
      const title = `Page ${page}${labels?.[page - 1] && labels[page - 1] !== String(page) ? ` (label ${labels[page - 1]})` : ''}`
      const accepted = sections.add({ title, location: { kind: 'pdf', page }, text: text.trim() || '[No searchable text layer on this page; visual inspection or OCR is required.]' })
      pdfPage.cleanup()
      if (!accepted) { visited--; break }
    }
    const partial = visited < doc.numPages || empty > 0
    return result(partial ? 'partial' : 'searchable', `PDF, ${doc.numPages} pages.`, `${visited} of ${doc.numPages} physical pages indexed; ${empty} visited pages have no searchable text layer. No OCR. Reading order and table layout may differ from the rendered page.${sections.truncated ? ' Text limit reached.' : ''}`, sections.items)
  } finally { await task.destroy() }
}

/** Parser entry: production callers use extractProjectFile's supervised child. */
export async function extractDocument(path: string, mediaType: string, originalName = '', options: ExtractionOptions = {}): Promise<ProjectFileExtraction> {
  try {
    if ((await stat(path)).size > EXTRACTION_LIMITS.original) return result('stored', 'File exceeds extraction size limit.', 'No content indexed.', [], 'Use a smaller reference file.')
    const bytes = await readFile(path)
    if (bytes.length > EXTRACTION_LIMITS.original) return result('stored', 'File exceeds extraction size limit.', 'No content indexed.', [], 'Use a smaller reference file.')
    const extension = (originalName || path).split('.').at(-1)?.toLowerCase()
    if (mediaType === 'application/pdf' || extension === 'pdf') return await extractPdf(bytes)
    if (bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
      // Modern encrypted Office documents use an OLE wrapper too. Do not call
      // every legacy DOC/XLS password protected merely because it is OLE.
      const protectedFile = bytes.includes(Buffer.from('EncryptedPackage', 'utf16le')) || bytes.includes(Buffer.from('EncryptionInfo', 'utf16le'))
      return result(protectedFile ? 'password' : 'stored', protectedFile ? 'Password-protected Office file.' : 'Legacy Office document.', 'No document contents indexed.', [], protectedFile ? 'Export an unencrypted copy to make the contents searchable.' : 'Export DOCX or XLSX and reimport it to enable search.')
    }
    if (extension === 'docx' || mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return extractDocx(await readOfficeParts(bytes))
    if (extension === 'xlsx' || mediaType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return extractXlsx(await readOfficeParts(bytes), options)
    if (mediaType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(extension || '')) {
      const dimensions = imageDimensions(bytes)
      if (!dimensions?.width || !dimensions.height) return result('stored', 'Image dimensions unavailable.', 'No visual interpretation or OCR performed.', [], 'Export a valid PNG, JPEG or WebP image and reimport it.')
      return { ...result('preview', `${dimensions.width} × ${dimensions.height} image.`, 'Image metadata only; appearance requires an image-capable assistant. No OCR.'), image: dimensions }
    }
    if (extension === 'csv' || mediaType === 'text/csv') return extractDelimited(bytes, ',')
    if (extension === 'tsv' || mediaType === 'text/tab-separated-values') return extractDelimited(bytes, '\t')
    if (mediaType.startsWith('text/') || ['txt', 'md', 'markdown', 'r', 'rmd', 'qmd', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'js', 'ts', 'py', 'sql', 'log'].includes(extension || '')) return extractText(bytes, originalName || 'Document')
    return result('stored', 'Original file retained.', 'No qualified content extractor is available for this format.', [], 'Export a supported format to make its contents searchable.')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/password|encrypted/i.test(message)) return result('password', 'Password-protected document.', 'No protected contents indexed.', [], 'Export an unencrypted copy and reimport it.')
    return result('error', 'Original file retained; indexing failed.', 'No reliable content index available.', [], `${message.slice(0, 400)} Retry indexing or export a supported, repaired copy.`)
  }
}
