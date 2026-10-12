import { expect, it } from 'vitest'
import { disclosedColumns, disclosedSchema, schemaColumns, validateColumnDisclosure } from './column-disclosure'
import { disclosureExclusions, executionBlocked } from './exclusions'
import { disclosureDialogue } from './disclosure-dialogue'

it('removes exact excluded names and types before descriptor indexing', () => {
  const columns = [{ name: 'income', type: 'double' }, { name: 'income_band', type: 'character' }]
  expect(disclosedColumns(columns, ['income'])).toEqual([columns[1]])
  expect(columns).toHaveLength(2)
  expect(disclosedColumns(undefined, ['income'])).toBeUndefined()
})

it('does not repeat excluded schema names through geometry or unexpected result fields', () => {
  const result = { columns: [{ name: 'secret', type: 'private type', units: 'private units' }, { name: 'public', type: 'double' }], crs: { input: 'secret' }, rows: [['private value']], totalColumns: 2 }
  const schema = disclosedSchema(result, ['secret'])
  expect(schema.columns).toEqual([{ name: 'public', type: 'double' }])
  expect(JSON.stringify(schema)).not.toMatch(/secret|private value|private type|private units/)
  expect(schema).toMatchObject({ completeness: 'partial' })
})

it('refuses malformed or unbounded local column selections', () => {
  expect(validateColumnDisclosure('environment:.GlobalEnv:roads', ['a', 'a']).columns).toEqual(['a'])
  expect(() => validateColumnDisclosure('document:roads', ['a'])).toThrow('Choose')
  expect(() => validateColumnDisclosure('environment:x', Array.from({ length: 257 }, (_, index) => `${index}`))).toThrow('Choose')
  expect(() => validateColumnDisclosure('environment:x', ['a\n'])).toThrow('Choose')
})

it('column privacy closes generic execution, document reads and derived dialogue bypasses', () => {
  const excluded = disclosureExclusions([], true)
  for (const name of ['execute_r_code', 'read_document', 'write_document', 'edit_document', 'run_ui_action', 'run_toolbox_tool']) expect(executionBlocked(name, {}, excluded, true)).toBe(true)
  expect(executionBlocked('context_read', {}, excluded, true)).toBe(false)
  expect(executionBlocked('run_ui_action', { id: 'theme:duplicate' }, excluded, true)).toBe(false)
  const user = { id: 'u', role: 'user' as const, content: 'Exact explicit request', timestamp: 1 }
  const assistant = { id: 'a', role: 'assistant' as const, content: 'Private derived result', timestamp: 2 }
  expect(disclosureDialogue([user, assistant], excluded, true)).toEqual([user])
  expect(disclosureExclusions([], false)).toEqual([])
})

it('normalises singleton R column metadata and strips unexpected data fields', () => {
  const column = { name: 'only_column', type: 'double', rows: [123], value: 'private' }
  expect(schemaColumns(column)).toEqual([{ name: 'only_column', type: 'double' }])
  expect(schemaColumns([column])).toEqual(schemaColumns(column))
  expect(schemaColumns('NULL')).toEqual([])
  expect(schemaColumns([null, {}, { name: 'bad', type: 1 }])).toEqual([])
  expect(disclosedSchema({ columns: column }, ['only_column']).columns).toEqual([])
})
