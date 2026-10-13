import { expect, it } from 'vitest'
import { failureSchemas } from './failure-schemas'
import type { ContextSource } from './types'
const source = (id: string, environment: string): ContextSource => ({ id, kind: 'environment', scope: 'workspace', title: `${environment}::parcels`, resource: { environment, name: 'parcels' }, summary: '', revision: '1', trust: 'observed', read: () => '' })
const failure = (command: string): ContextSource => ({ id: 'console:join', kind: 'console', scope: 'workspace', title: 'Failed join', summary: 'Error: unrelated_secret_object', command, revision: '1', trust: 'untrusted', read: () => '' })
it('pairs an old join failure with unambiguous current input schema without reading error prose', () => {
  expect(failureSchemas([failure("result <- dplyr::left_join(parcels, owners, by = 'parcel_id')")], [source('parcels', '.GlobalEnv')], [])).toEqual(['parcels'])
})
it('does not infer dependencies from quoted or dynamic inputs and compound commands', () => {
  for (const code of ["print('left_join(parcels, owners)')", "left_join(get('parcels'), owners)", 'left_join(parcels, owners); stop("other")', '# left_join(parcels, owners)']) expect(failureSchemas([failure(code)], [source('parcels', '.GlobalEnv')], [])).toEqual([])
})
it('keeps ambiguous and excluded console/object sources out of automatic schema reads', () => {
  const objects = [source('global', '.GlobalEnv'), source('study', 'study')]
  expect(failureSchemas([failure('left_join(parcels, owners)')], objects, [])).toEqual([])
  expect(failureSchemas([failure('left_join(study$parcels, owners)')], objects, [])).toEqual(['study'])
  expect(failureSchemas([failure('left_join(study$parcels, owners)')], objects, ['study'])).toEqual([])
  expect(failureSchemas([failure('left_join(study$parcels, owners)')], objects, ['console:join'])).toEqual([])
})
