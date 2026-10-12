import type { ContextScope } from './types'
import { redactContext } from './policy'

export type ExclusionScope = 'application' | 'global' | 'project'
export interface ExclusionSelection { scope: ExclusionScope; projectId: string | null; ids: string[] }

/** Local privacy choices do not travel in bundles. Workspace sources in scratch
 * have no durable identity; their exclusions end with that workspace. */
export function exclusionScope(scope: ContextScope, projectId: string | null): ExclusionScope | null {
  if (scope === 'application' || scope === 'global') return scope
  return projectId ? 'project' : null
}

export function validateExclusions(input: unknown, scope: ExclusionScope): string[] {
  if (!Array.isArray(input) || input.length > 10000) throw new Error('Too many excluded sources. Review a smaller selection.')
  const allowed = scope === 'application' ? ['skill', 'action'] : scope === 'global' ? ['memory'] : ['environment', 'console', 'document', 'conversation', 'memory']
  if (input.some(id => typeof id !== 'string' || id.length > 8192 || [...id].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || redactContext(id) !== id || !allowed.includes(id.split(':')[0]) || !id.includes(':'))) {
    throw new Error('Choose an authorised source from the Context inspector.')
  }
  if (JSON.stringify(input).length > 8_000_000) throw new Error('Source exclusions exceed the storage limit. Review a smaller selection.')
  return [...new Set(input)]
}

/** Generic execution can read arbitrary data and return it outside the source
 * adapter. Until those results carry complete source/column lineage, pause
 * that route when a private source is excluded. App-reference exclusions do
 * not hide user data, and theme actions only inspect application palettes. */
export const COLUMN_PRIVACY_MARKER = 'column-privacy:workspace'

export function disclosureExclusions(excluded: string[], privateColumns: boolean): string[] {
  return privateColumns ? [...excluded, COLUMN_PRIVACY_MARKER] : excluded
}

export function executionBlocked(name: string, input: Record<string, unknown>, excluded: string[], loaded: boolean): boolean {
  if (loaded && !excluded.some(id => !id.startsWith('skill:') && !id.startsWith('action:'))) return false
  if (excluded.includes(COLUMN_PRIVACY_MARKER) && name === 'read_document') return true
  if (name === 'run_ui_action' && typeof input.id === 'string' && input.id.startsWith('theme:')) return false
  return ['execute_r_code', 'run_ui_action', 'run_toolbox_tool', 'write_document', 'edit_document'].includes(name)
}
