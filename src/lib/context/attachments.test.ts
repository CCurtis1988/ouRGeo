import { describe, expect, it } from 'vitest'
import { addAttachment, attachmentHeadroom, attachmentSections, stageAttachment } from './attachments'
import type { ContextSource } from './types'

const source = (id: string): ContextSource => ({ id, kind: 'document', scope: 'workspace', title: id, summary: '', revision: 'buffer:5', trust: 'user', read: () => { throw new Error('Staging must not read content') } })

describe('explicit attachment descriptors', () => {
  it('preserves exact source revision, epoch and range without reading a body', () => {
    expect(stageAttachment(source('document:active'), 17, { startLine: 2, endLine: 7 })).toEqual({ sourceId: 'document:active', revision: 'buffer:5', workspaceEpoch: 17, kind: 'document', title: 'document:active', range: { startLine: 2, endLine: 7 } })
  })
  it('updates an explicitly reselected revision without adding duplicate sources', () => {
    const prior = stageAttachment(source('document:active'), 17)
    const changed = stageAttachment({ ...source('document:active'), revision: 'buffer:6' }, 17)
    expect(addAttachment([prior], changed)).toEqual([changed])
  })
  it('refuses a fourth source instead of silently dropping an earlier attachment', () => {
    const choices = ['a', 'b', 'c'].map(id => stageAttachment(source(id), 17))
    expect(() => addAttachment(choices, stageAttachment(source('d'), 17))).toThrow('Remove one')
    expect(choices.map(item => item.sourceId)).toEqual(['a', 'b', 'c'])
  })
  it('keeps whole fenced code chunks and ignores their apparent headings', () => {
    const text = '# First\nintro\n````{r}\n# not a section\n```\nx <- 1\n````\n## Next\nresult'
    expect(attachmentSections(text)).toEqual([{ title: 'First', startLine: 1, endLine: 7 }, { title: 'Next', startLine: 8, endLine: 9 }])
  })
  it('makes preamble and later headings separately selectable without losing text', () => {
    expect(attachmentSections('title\n\n# Analysis\nbody')).toEqual([{ title: 'Opening section', startLine: 1, endLine: 2 }, { title: 'Analysis', startLine: 3, endLine: 4 }])
  })
  it('reserves attachment space by selecting older assistant replies before refusing a long conversation', () => {
    const messages = [{ id: 'critical', role: 'user' as const, content: 'Use metres exactly.', timestamp: 0 }, { id: 'large', role: 'assistant' as const, content: 'old reply '.repeat(3000), timestamp: 1 }, { id: 'latest', role: 'user' as const, content: 'Check the attached section.', timestamp: 2 }]
    expect(attachmentHeadroom(messages, { system: 'Rules', tools: [], pins: '' }, 10000, 1000, 0)).toBe(0)
    expect(attachmentHeadroom(messages, { system: 'Rules', tools: [], pins: '' }, 10000, 1000, 1)).toBeGreaterThan(2400)
  })
  it('does not make space by cutting oversized original user instructions', () => {
    const messages = [{ id: 'instructions', role: 'user' as const, content: 'Required instruction '.repeat(3000), timestamp: 0 }]
    expect(attachmentHeadroom(messages, { system: 'Rules', pins: 'Always apply' }, 10000, 1000, 1)).toBe(0)
  })
})
