import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import AdmZip from 'adm-zip'
import { jsPDF } from 'jspdf'
import { extractDocument, readOfficeParts } from './extraction'

const directories: string[] = []
async function file(name: string, contents: string | Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ourgeo-extraction-')); directories.push(dir)
  const path = join(dir, name); await writeFile(path, contents); return path
}
function office(parts: Record<string, string>): Buffer {
  const archive = new AdmZip()
  for (const [name, value] of Object.entries(parts)) archive.addFile(name, Buffer.from(value))
  return archive.toBuffer()
}
const document = (contents: string): Buffer => office({ 'word/document.xml': `<w:document xmlns:w="urn:word"><w:body>${contents}</w:body></w:document>` })
const workbook = (): Buffer => office({
  'xl/workbook.xml': '<workbook xmlns:r="urn:relationships"><workbookPr date1904="1"/><sheets><sheet name="Overview" sheetId="1" r:id="r1"/><sheet name="Measurements" sheetId="2" r:id="r2"/><sheet name="SECRET_SHEET_NAME" state="hidden" sheetId="3" r:id="r3"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/><Relationship Id="r3" Target="worksheets/sheet3.xml"/><Relationship Id="external" Target="https://invalid.example/secret" TargetMode="External"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>00123</t></si><si><t>HIDDEN_SHARED_SECRET</t></si></sst>',
  'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="0.00&quot; m&quot;"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="10"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Cover</t></is></c></row></sheetData></worksheet>',
  'xl/worksheets/sheet2.xml': '<worksheet><cols><col min="5" max="5" hidden="1"/></cols><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>0.125</v></c><c r="C1" s="2"><v>0</v></c><c r="D1"><f>SUM(A2:A3)</f><v>7</v></c><c r="E1" t="s"><v>1</v></c><c r="F1"/></row><row r="2" hidden="true"><c r="A2" t="inlineStr"><is><t>HIDDEN_ROW_SECRET</t></is></c></row><row r="80"><c r="D80" s="3"><v>2</v></c><c r="G80" t="inlineStr"><is><t>Independent non-first-sheet requirement</t></is></c></row></sheetData><mergeCells><mergeCell ref="G80:H80"/></mergeCells></worksheet>',
  'xl/worksheets/sheet3.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>HIDDEN_SHEET_SECRET</t></is></c></row></sheetData></worksheet>'
})

afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('bounded project document extraction', () => {
  it('retains exact UTF-8 line locations and metadata independent of AI', async () => {
    const extraction = await extractDocument(await file('blob', '# Standard\nCafé\n\nLast line'), 'text/markdown', 'standard.md')
    expect(extraction.status).toBe('searchable')
    expect(extraction.sections[0]).toMatchObject({ location: { kind: 'lines', start: 1, end: 4 }, text: '# Standard\nCafé\n\nLast line' })
    expect(extraction.description).toContain('Standard')
  })
  it('refuses unsupported encodings without silently replacing source characters', async () => {
    const extraction = await extractDocument(await file('legacy.txt', Buffer.from([0xff, 0xfe, 0x41, 0])), 'text/plain')
    expect(extraction.status).toBe('error'); expect(extraction.sections).toEqual([])
  })
  it('preserves CSV strings, quoted newlines, escaped quotes and physical locations', async () => {
    const extraction = await extractDocument(await file('a.csv', 'code,note\r\n00123,"two\nlines and ""quote"""\r\n02/03/24,7'), 'text/csv')
    expect(extraction.status).toBe('searchable')
    expect(extraction.sections[1]).toMatchObject({ location: { kind: 'lines', start: 2, end: 3 } })
    expect(extraction.sections[1].text).toContain('"00123"')
    expect(extraction.sections[1].text).toContain('two\\nlines and \\"quote\\"')
    expect(extraction.sections[2].text).toContain('"02/03/24"')
    expect(extraction.coverage).toContain('No date or number conversion')
  })
  it('reports malformed CSV as partial instead of searchable', async () => {
    const extraction = await extractDocument(await file('a.tsv', 'code\tnote\n001\t"unfinished'), 'text/tab-separated-values')
    expect(extraction.status).toBe('partial'); expect(extraction.coverage).toContain('Unterminated')
  })
  it('keeps DOCX headings, list items and table-cell locations without inventing pages', async () => {
    const contents = document('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Design standard</w:t></w:r></w:p><w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Use blue</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Minimum width 2 mm</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')
    const extraction = await extractDocument(await file('report.docx', contents), 'application/octet-stream')
    expect(extraction.status).toBe('searchable')
    expect(extraction.sections[0]).toMatchObject({ title: 'Heading 1: Design standard', location: { kind: 'docx', section: 1 } })
    expect(extraction.sections[1].text).toBe('• Use blue')
    expect(extraction.sections[2].text).toBe('R1C1: Minimum width 2 mm')
    expect(extraction.coverage).toContain('Word pagination is unavailable')
  })
  it('excludes hidden and deleted DOCX text before catalogue generation', async () => {
    const contents = document('<w:p><w:r><w:t>Visible</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>SECRET</w:t></w:r><w:del><w:r><w:delText>DELETED</w:delText></w:r></w:del></w:p>')
    const extraction = await extractDocument(await file('report.docx', contents), 'application/octet-stream')
    expect(JSON.stringify(extraction)).not.toContain('SECRET')
    expect(JSON.stringify(extraction)).not.toContain('DELETED')
    expect(extraction.sections[0].text).toBe('Visible')
  })
  it('marks omitted DOCX structures truthfully', async () => {
    const contents = office({ 'word/document.xml': '<document><body><p><r><t>Report</t></r></p><altChunk/></body></document>', 'word/footer1.xml': '<ftr><p>Footer text</p></ftr>' })
    const extraction = await extractDocument(await file('report.docx', contents), 'application/octet-stream')
    expect(extraction.status).toBe('partial'); expect(extraction.coverage).toContain('omitted')
  })
  it('preserves XLSX raw/type/display/formulas, date system, blank cells and merged ranges', async () => {
    const extraction = await extractDocument(await file('book.xlsx', workbook()), 'application/octet-stream')
    expect(extraction.status).toBe('searchable')
    const at = (range: string): string => extraction.sections.find(section => section.location.kind === 'sheet' && section.location.sheet === 'Measurements' && section.location.range === range)!.text
    expect(at('A1')).toContain('"value":"00123"')
    expect(at('B1')).toContain('"raw":"0.125"'); expect(at('B1')).toContain('"displayed":"12.50%"')
    expect(at('C1')).toContain('"displayed":"1904-01-01"')
    expect(at('D1')).toContain('"formula":"SUM(A2:A3)"'); expect(at('D1')).toContain('"cachedResult":"7"')
    expect(at('F1')).toContain('"type":"blank"')
    expect(at('G80')).toContain('Independent non-first-sheet requirement')
    expect(at('D80')).toContain('"displayed":"2.00 m"')
    expect(extraction.sections.find(section => section.title === 'Measurements: structure')!.text).toContain('G80:H80')
    expect(extraction.coverage).toContain('Date system 1904')
  })
  it('never leaks hidden workbook sheet/row/column values into output or metadata', async () => {
    const extraction = await extractDocument(await file('book.xlsx', workbook()), 'application/octet-stream')
    expect(JSON.stringify(extraction)).not.toContain('SECRET')
    expect(extraction.coverage).toContain('1 hidden sheets and 2 hidden cells excluded')
  })
  it('includes hidden workbook contents only after an explicit selection', async () => {
    const extraction = await extractDocument(await file('book.xlsx', workbook()), 'application/octet-stream', 'book.xlsx', { includeHidden: true })
    expect(extraction.sections.some(section => section.text.includes('HIDDEN_ROW_SECRET'))).toBe(true)
    expect(extraction.sections.some(section => section.text.includes('HIDDEN_SHARED_SECRET'))).toBe(true)
    expect(extraction.sections.some(section => section.text.includes('HIDDEN_SHEET_SECRET'))).toBe(true)
    expect(extraction.coverage).toContain('explicitly included')
    expect(extraction.description).not.toContain('SECRET')
  })
  it('never dereferences external Office relationships or XML entities', async () => {
    const external = office({ 'word/document.xml': '<!DOCTYPE x [<!ENTITY remote SYSTEM "file:///etc/passwd">]><document><body><p>&remote;</p></body></document>' })
    const extraction = await extractDocument(await file('entity.docx', external), 'application/octet-stream')
    expect(extraction.status).toBe('error'); expect(extraction.sections).toEqual([])
    expect(extraction.issue).toContain('unsupported XML declarations')
  })
  it('rejects case-conflicting Office entries before using their contents', async () => {
    const archive = office({ 'word/document.xml': '<document/>', 'WORD/document.xml': '<different/>' })
    await expect(readOfficeParts(archive)).rejects.toThrow('unsafe or conflicting')
  })
  it('rejects a false uncompressed-size claim against actual streamed bytes', async () => {
    const archive = office({ 'word/document.xml': '<document><body><p>Actual content</p></body></document>' })
    // Both records must agree on the forged size so this checks actual output,
    // rather than merely comparing two attacker-controlled header fields.
    for (let offset = 0; offset < archive.length - 4; offset++) {
      if (archive.readUInt32LE(offset) === 0x04034b50) archive.writeUInt32LE(1, offset + 22)
      if (archive.readUInt32LE(offset) === 0x02014b50) archive.writeUInt32LE(1, offset + 24)
    }
    await expect(readOfficeParts(archive)).rejects.toThrow()
  })
  it('rejects a small compressed Office archive with an oversized XML part', async () => {
    const archive = office({ 'word/document.xml': 'x'.repeat(32 * 1024 ** 2 + 1) })
    expect(archive.length).toBeLessThan(100_000)
    await expect(readOfficeParts(archive)).rejects.toThrow('XML part exceeds')
  })
  it('finds independent evidence on physical PDF page 80', async () => {
    const pdf = new jsPDF()
    for (let page = 1; page <= 80; page++) { if (page > 1) pdf.addPage(); pdf.text(page === 80 ? 'Required clearance is 17 metres.' : `Report page ${page}`, 20, 20) }
    const extraction = await extractDocument(await file('report.pdf', Buffer.from(pdf.output('arraybuffer'))), 'application/pdf')
    expect(extraction.status).toBe('searchable')
    expect(extraction.sections[79]).toMatchObject({ location: { kind: 'pdf', page: 80 } })
    expect(extraction.sections[79].text).toContain('Required clearance is 17 metres.')
  }, 60_000)
  it('labels PDF pages without a text layer instead of claiming whole-document coverage', async () => {
    const pdf = new jsPDF(); pdf.text('Searchable page', 20, 20); pdf.addPage()
    const extraction = await extractDocument(await file('mixed.pdf', Buffer.from(pdf.output('arraybuffer'))), 'application/pdf')
    expect(extraction.status).toBe('partial'); expect(extraction.coverage).toContain('1 visited pages have no searchable text layer')
    expect(extraction.sections[1].text).toContain('No searchable text layer')
  })
  it('retains encrypted PDFs with a truthful password status', async () => {
    const pdf = new jsPDF({ encryption: { userPassword: 'secret', ownerPassword: 'owner', userPermissions: ['print'] } }); pdf.text('Protected text', 20, 20)
    const extraction = await extractDocument(await file('protected.pdf', Buffer.from(pdf.output('arraybuffer'))), 'application/pdf')
    expect(extraction.status).toBe('password'); expect(extraction.sections).toEqual([])
  })
  it('distinguishes legacy Office from encrypted modern Office wrappers', async () => {
    const header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    expect((await extractDocument(await file('legacy.doc', header), 'application/msword')).status).toBe('stored')
    expect((await extractDocument(await file('encrypted.docx', Buffer.concat([header, Buffer.from('EncryptedPackage', 'utf16le')])), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).status).toBe('password')
  })
  it('reports image dimensions without inventing a visual description', async () => {
    const header = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header); header.writeUInt32BE(320, 16); header.writeUInt32BE(200, 20)
    const extraction = await extractDocument(await file('figure.png', header), 'image/png')
    expect(extraction).toMatchObject({ status: 'preview', image: { width: 320, height: 200 }, sections: [] })
    expect(extraction.description).toBe('320 × 200 image.')
  })
  it('stores unqualified binaries without claiming contents were understood', async () => {
    const extraction = await extractDocument(await file('unknown.bin', Buffer.from([0, 1, 2])), 'application/octet-stream')
    expect(extraction.status).toBe('stored'); expect(extraction.sections).toEqual([])
  })
})
