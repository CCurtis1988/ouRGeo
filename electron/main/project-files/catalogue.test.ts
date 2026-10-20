import { describe, expect, it } from 'vitest'
import { emptyLibrary, validateLibrary } from './catalogue'
import { fixtureEntry } from './test-fixtures'
import { PROJECT_FILE_LIMITS } from '../../../src/lib/project-files'

describe('portable project catalogue validation', () => {
  it('accepts supported metadata while stripping untrusted authority fields', () => {
    const entry = { ...fixtureEntry(), saved: false, localPath: '/private/secret', extraAuthority: 'forged' }
    const catalogue = validateLibrary({ version: 1, revision: 1, files: [entry] })
    expect(catalogue.files[0]).toMatchObject({ saved: true, name: 'reference.md' })
    expect(catalogue.files[0]).not.toHaveProperty('localPath')
    expect(catalogue.files[0]).not.toHaveProperty('extraAuthority')
  })
  it('roundtrips optional AI provenance while stripping injected authority fields', () => {
    const entry = fixtureEntry({ aiDescription: { text: 'Derived summary', revision: fixtureEntry().revision, provider: 'ollama', model: 'document-model', createdAt: '2026-10-17T00:00:00.000Z', coverage: 'First paragraph only.' } })
    const input = { ...entry, aiDescription: { ...entry.aiDescription!, path: '/private/authority', allowRead: true } }
    const catalogue = validateLibrary({ version: 1, revision: 2, files: [input] })
    expect(catalogue.files[0].aiDescription).toEqual(entry.aiDescription)
    expect(catalogue.files[0].aiDescription).not.toHaveProperty('path')
    expect(() => validateLibrary({ version: 1, revision: 2, files: [{ ...entry, aiDescription: { ...entry.aiDescription, text: 'x'.repeat(2001) } }] })).toThrow('AI file-description metadata')
  })
  it.each([
    { version: 3, revision: 0, files: [] },
    { version: 1, revision: -1, files: [] },
    { version: 1, revision: 0, files: [fixtureEntry({ sha256: '../escape' })] },
    { version: 1, revision: 0, files: [fixtureEntry({ revision: 'forged' })] },
    { version: 1, revision: 0, files: [fixtureEntry({ bytes: PROJECT_FILE_LIMITS.fileBytes + 1 })] },
    { version: 1, revision: 0, files: [fixtureEntry(), fixtureEntry()] },
    { version: 1, revision: 0, files: [fixtureEntry({ name: '\0unsafe' })] }
  ])('refuses unsupported or corrupted metadata %#', input => {
    expect(() => validateLibrary(input)).toThrow()
  })
  it('bounds the aggregate original size as well as each file', () => {
    const files = Array.from({ length: 11 }, (_, index) => fixtureEntry({ id: `4d67478e-91f7-41ce-b507-${String(index).padStart(12, '0')}`, bytes: PROJECT_FILE_LIMITS.fileBytes }))
    expect(() => validateLibrary({ ...emptyLibrary(), files })).toThrow('1 GiB')
  })
})
