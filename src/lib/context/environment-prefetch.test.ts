import { expect, it } from 'vitest'
import { environmentPrefetch } from './environment-prefetch'
import type { ContextSource } from './types'
const source = (environment: string, name: string): ContextSource => ({ id: `${environment}:${name}`, title: `${environment}::${name}`, resource: { environment, name }, kind: 'environment', scope: 'workspace', summary: '', revision: '1', trust: 'observed', read: () => '' })
it('selects a named schema request with brackets, backticks or a plain object name', () => {
  const sources = [source('.GlobalEnv', 'memory_acceptance_data')]
  for (const question of ['Describe the schema of memory_acceptance_data.', 'Which columns are in `memory_acceptance_data`?', 'Describe [memory_acceptance_data].', 'Describe .GlobalEnv::memory_acceptance_data.']) expect(environmentPrefetch(sources, question)).toEqual(['.GlobalEnv:memory_acceptance_data'])
})
it('does not choose ambiguous names or matches inside other identifiers', () => {
  const sources = [source('.GlobalEnv', 'roads'), source('other', 'roads')]
  expect(environmentPrefetch(sources, 'Describe roads schema')).toEqual([])
  expect(environmentPrefetch(sources, 'Describe [other::roads] schema')).toEqual(['other:roads'])
  expect(environmentPrefetch([sources[0]], 'Describe railroads or roads_archive schema')).toEqual([])
})
