import { expect, it } from 'vitest'
import { schemaRevision } from './schema-revision'

it('does not mistake column-cache hydration or a late inventory replacement for a source mutation', () => {
  const object = { class: 'data.frame', dim: [1, 1], columns: undefined }
  const hydrated = { ...object, columns: [{ name: 'parcel_id', type: 'integer' }] }
  expect(schemaRevision('workspace:runtime:execution', object, [])).toBe(schemaRevision('workspace:runtime:execution', hydrated, []))
})

it('revokes schema observations when execution, scope, shape, class or disclosure changes', () => {
  const object = { class: 'data.frame', dim: [1, 1] }, before = schemaRevision('workspace:runtime:execution', object, [])
  for (const changed of [schemaRevision('workspace:runtime:next-execution', object, []), schemaRevision('other-workspace:runtime:execution', object, []),
    schemaRevision('workspace:next-runtime:execution', object, []), schemaRevision('workspace:runtime:execution', { ...object, dim: [2, 1] }, []),
    schemaRevision('workspace:runtime:execution', { ...object, class: 'matrix' }, []), schemaRevision('workspace:runtime:execution', object, ['parcel_id'])]) expect(changed).not.toBe(before)
})
