/** Column names are local UI choices, never model-selected permission grants.
 * Exact matching avoids hiding an unrelated column with a similar spelling. */
export interface ColumnDisclosure { sourceId: string; columns: string[] }

function hasControls(text: string): boolean {
  return [...text].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

export function validateColumnDisclosure(sourceId: string, columns: string[]): ColumnDisclosure {
  if (!sourceId.startsWith('environment:') || sourceId.length > 8192 || hasControls(sourceId) || !Array.isArray(columns) || columns.length > 256 || columns.some(name => typeof name !== 'string' || !name || name.length > 256 || hasControls(name))) {
    throw new Error('Choose up to 256 named columns from a workspace object.')
  }
  return { sourceId, columns: [...new Set(columns)] }
}

/** jsonlite may unbox a one-column list. Treat both wire shapes as metadata,
 * and discard unexpected fields before they can enter search or model context. */
export function schemaColumns(input: unknown): { name: string; type: string; units?: string }[] {
  const entries = Array.isArray(input) ? input : input && typeof input === 'object' ? [input] : []
  return entries.slice(0, 256).flatMap(entry => {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || typeof entry.type !== 'string') return []
    return [{ name: entry.name, type: entry.type, ...(typeof entry.units === 'string' ? { units: entry.units } : {}) }]
  })
}

export function disclosedColumns<T extends { name: string }>(columns: T[] | undefined, excluded: string[]): T[] | undefined {
  if (!columns) return undefined
  const denied = new Set(excluded)
  return columns.filter(column => !denied.has(column.name))
}

/** Return only known schema fields: an upstream error/debug payload must not
 * turn a schema-only read into an accidental data-value disclosure. */
export function disclosedSchema(result: { columns?: unknown; observedAt?: unknown; completeness?: unknown; crs?: unknown }, excluded: string[]): Record<string, unknown> {
  const columns = disclosedColumns(schemaColumns(result.columns), excluded)?.map(column => ({ name: column.name, type: column.type, ...(typeof column.units === 'string' ? { units: column.units } : {}) })) ?? []
  return { success: true, columns, ...(typeof result.observedAt === 'string' ? { observedAt: result.observedAt } : {}), completeness: result.completeness === 'partial' || excluded.length ? 'partial' : 'complete', ...(excluded.length ? { disclosure: 'Some column metadata is excluded by local privacy settings.' } : { crs: result.crs ?? null }) }
}
