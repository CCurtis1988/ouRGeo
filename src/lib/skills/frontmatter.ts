// The YAML subset that SKILL.md front matter uses, and nothing more.
//
// Skills arrive from Claude Code, Codex, Hermes and hand-written files, so the
// parser is lenient in the ways the agentskills.io client guide asks for: an
// unquoted colon inside a value is part of the value, unknown keys are kept,
// and a line it cannot read is skipped rather than failing the whole file.
// What it does not do — anchors, tags, multi-document streams, flow maps — no
// skill format uses. ouRGeo has no YAML dependency and this is not a reason to
// add one (CLAUDE.md: runtime dependencies are justified one by one).

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue }

interface Line { indent: number; text: string }

const meaningful = (raw: string): Line | null => {
  if (!raw.trim() || /^\s*#/.test(raw)) return null
  return { indent: raw.length - raw.trimStart().length, text: raw.trim() }
}

/** A plain or quoted scalar. Numbers and booleans only when unquoted. */
function scalar(text: string): YamlValue {
  const value = text.replace(/\s+#.*$/, '')
  if (/^".*"$/.test(value)) {
    try { return JSON.parse(value) as string } catch { return value.slice(1, -1) }
  }
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'")
  if (value === 'true' || value === 'false') return value === 'true'
  if (value === 'null' || value === '~' || value === '') return value === '' ? '' : null
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (/^\[.*\]$/.test(value)) return splitFlow(value.slice(1, -1)).map(scalar)
  return text.trim()
}

/** `[a, "b, c", d]` → three items: commas inside quotes are not separators. */
function splitFlow(inner: string): string[] {
  const items: string[] = []
  let current = '', quote = ''
  for (const ch of inner) {
    if (quote) { current += ch; if (ch === quote) quote = ''; continue }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue }
    if (ch === ',') { items.push(current.trim()); current = ''; continue }
    current += ch
  }
  if (current.trim()) items.push(current.trim())
  return items
}

/** `|` keeps line breaks; `>` folds them into spaces, as YAML does. */
function blockScalar(lines: string[], start: number, parentIndent: number, folded: boolean): [string, number] {
  const out: string[] = []
  let i = start, indent = -1
  for (; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) { out.push(''); continue }
    const own = raw.length - raw.trimStart().length
    if (own <= parentIndent) break
    if (indent < 0) indent = own
    out.push(raw.slice(Math.min(indent, own)))
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return [folded ? out.join('\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ') : out.join('\n'), i]
}

function block(lines: string[], start: number, indent: number): [YamlValue, number] {
  let i = start
  while (i < lines.length && !meaningful(lines[i])) i++
  const first = i < lines.length ? meaningful(lines[i]) : null
  if (!first || first.indent < indent) return ['', i]
  if (first.text.startsWith('- ') || first.text === '-') {
    const list: YamlValue[] = []
    while (i < lines.length) {
      const line = meaningful(lines[i])
      if (!line) { i++; continue }
      if (line.indent < first.indent || !(line.text.startsWith('- ') || line.text === '-')) break
      list.push(scalar(line.text.slice(1).trim()))
      i++
    }
    return [list, i]
  }
  const map: { [key: string]: YamlValue } = {}
  while (i < lines.length) {
    const line = meaningful(lines[i])
    if (!line) { i++; continue }
    if (line.indent < first.indent) break
    if (line.indent > first.indent) { i++; continue } // stray deeper line: skipped, not fatal
    const match = line.text.match(/^([^:\s][^:]*?):(?:\s+(.*))?$/)
    if (!match) { i++; continue }
    const key = match[1].trim().replace(/^["']|["']$/g, '')
    const rest = (match[2] ?? '').trim()
    if (rest === '|' || rest === '>' || /^[|>][+-]?$/.test(rest)) {
      const [text, next] = blockScalar(lines, i + 1, line.indent, rest.startsWith('>'))
      map[key] = text; i = next; continue
    }
    if (rest) { map[key] = scalar(rest); i++; continue }
    const [value, next] = block(lines, i + 1, line.indent + 1)
    map[key] = value; i = next
  }
  return [map, i]
}

/** Parse front matter text (without its `---` fences) into a plain object. */
export function parseYaml(text: string): { [key: string]: YamlValue } {
  const [value] = block(text.replace(/\r\n/g, '\n').split('\n'), 0, 0)
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * Write a value back. Strings are JSON-quoted, which is valid YAML double-quoted
 * text and survives every character a description can contain; lists are flow
 * sequences, which every YAML reader accepts.
 */
export function stringifyYaml(value: { [key: string]: YamlValue }, indent = 0): string {
  const pad = ' '.repeat(indent)
  return Object.entries(value).filter(([, v]) => v !== undefined).map(([key, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return `${pad}${key}:\n${stringifyYaml(v, indent + 2)}`
    if (Array.isArray(v)) return `${pad}${key}: [${v.map(item => JSON.stringify(item)).join(', ')}]`
    return `${pad}${key}: ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`
  }).join('\n')
}
