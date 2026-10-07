import { createHash } from 'node:crypto'
import type { AuthorisedFileLink } from '../../../src/lib/context/types'

const path = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0')
const databaseId = (filePath: string): string => `database:${createHash('sha256').update(filePath).digest('hex')}`

export function collectFileLinks(tabs: unknown, databases: unknown): AuthorisedFileLink[] {
  if (!Array.isArray(tabs) || !Array.isArray(databases) || tabs.length > 10000 || databases.length > 10000) throw new Error('Project file links exceed the save limit.')
  const links: AuthorisedFileLink[] = tabs.flatMap(tab => tab && typeof tab.id === 'string' && tab.id.length <= 128 && path(tab.filePath) ? [{ id: tab.id, filePath: tab.filePath }] : [])
  for (const database of databases) if (database && path(database.filePath)) links.push({ id: databaseId(database.filePath), filePath: database.filePath })
  if (JSON.stringify(links).length > 8_000_000) throw new Error('Project file links exceed the protected registry limit.')
  return links
}

export function authorisedDatabaseLinks(databases: unknown, links: AuthorisedFileLink[]): string[] {
  if (!Array.isArray(databases) || databases.length > 10000) return []
  return databases.flatMap(database => database && path(database.filePath) && links.some(link => link.id === databaseId(database.filePath) && link.filePath === database.filePath) ? [database.filePath] : [])
}
