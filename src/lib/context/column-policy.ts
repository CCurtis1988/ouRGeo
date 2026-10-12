import { validateColumnDisclosure } from './column-disclosure'

export interface ColumnPolicySnapshot { revision: number; selections: Record<string, string[]> }

/** These are profile-local permissions, never project-bundle contributions. */
export function validateColumnPolicy(input: unknown): ColumnPolicySnapshot {
  if (!input || typeof input !== 'object') throw new Error('Column privacy settings are unavailable. Restore protected storage before using workspace context.')
  const value = input as ColumnPolicySnapshot
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !value.selections || typeof value.selections !== 'object' || Array.isArray(value.selections)) throw new Error('Column privacy settings need repair. Restore protected storage before using workspace context.')
  const entries = Object.entries(value.selections)
  if (entries.length > 1000 || JSON.stringify(input).length > 1_000_000) throw new Error('Column privacy settings exceed the local limit. Review a smaller selection.')
  const selections: Record<string, string[]> = Object.create(null)
  for (const [id, columns] of entries) {
    const valid = validateColumnDisclosure(id, columns)
    if (valid.columns.length) selections[id] = valid.columns
  }
  return { revision: value.revision, selections }
}
