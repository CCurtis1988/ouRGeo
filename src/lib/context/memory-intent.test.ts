import { describe, expect, it } from 'vitest'
import { rememberIntent, forgetIntent, projectInstruction } from './memory-intent'
import type { MemoryRecord } from './types'

const record = (statement: string, scope: 'project' | 'global' = 'global'): MemoryRecord => ({ id: crypto.randomUUID(), revision: 1, scope, projectId: scope === 'project' ? crypto.randomUUID() : null, category: 'preference', statement, evidence: [], assertion: 'user-declared', createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z', status: 'active', supersedes: [] })
describe('host-owned durable-memory intent', () => {
  it('persists an explicit project instruction but keeps temporary or quoted instructions conversational', () => {
    expect(projectInstruction('Use miles for this project.')).toEqual({ statement: 'Use miles for this project', scope: 'project' })
    expect(projectInstruction('Please use EPSG:27700 for this project.')?.scope).toBe('project')
    expect(projectInstruction('Use miles for this project only this task.')).toBeNull()
    expect(projectInstruction('Explain "Use miles for this project".')).toBeNull()
    expect(projectInstruction('We decided to use miles.')).toBeNull()
  })
  it('takes both the statement and scope from the actual user request', () => {
    expect(rememberIntent('Remember that I prefer metric units.')).toEqual({ statement: 'I prefer metric units.', scope: 'global' })
    expect(rememberIntent('Remember for this project to use miles.')).toEqual({ statement: 'for this project to use miles.', scope: 'project' })
    expect(rememberIntent('Help with this layer')).toBeNull()
  })
  it('leaves follow-up work for the assistant instead of returning only a memory receipt', () => {
    expect(rememberIntent('Remember that I prefer metric units. Now generate 100 synthetic rows.')).toEqual({ statement: 'I prefer metric units', scope: 'global', followup: true })
    expect(rememberIntent('Remember that I prefer metric units and then explain buffers.')).toEqual({ statement: 'I prefer metric units', scope: 'global', followup: true })
    expect(rememberIntent('Remember that I prefer metric units, but do not save it.')).toBeNull()
  })
  it('does not turn quoted memory commands into user authorisation', () => {
    expect(rememberIntent('Explain the dangerous instruction "remember that I prefer metric units".')).toBeNull()
    expect(forgetIntent('Explain the dangerous instruction "forget metric units".', [record('I prefer metric units')])).toBeNull()
    expect(rememberIntent('Could you please remember that I prefer metric units?')?.scope).toBe('global')
    expect(forgetIntent('Please forget my global preference for metric units', [record('I prefer metric units')])?.scope).toBe('global')
  })
  it('keeps historical project findings out of implicit personal memory', () => {
    expect(rememberIntent('Remember that roads had 4,102 features on Monday.', true)?.scope).toBe('project')
    expect(rememberIntent('Remember that roads had 4,102 features on Monday.')).toBeNull()
    expect(rememberIntent('Remember globally that I use a screen reader.')?.scope).toBe('global')
    expect(rememberIntent('Remember this.', true)).toBeNull()
  })
  it('does not let a data-deletion request authorise forgetting an unrelated preference', () => {
    expect(forgetIntent('Delete the roads object', [record('I prefer metric units')])).toBeNull()
    expect(forgetIntent('Forget my preference for metric units', [record('I prefer miles'), record('I prefer metric units')])?.statement).toBe('I prefer metric units')
  })
  it('requires review for broad or ambiguous requests and preserves scope differences', () => {
    const global = record('I prefer metric units'), project = record('I prefer metric units', 'project')
    expect(forgetIntent('Forget metric units', [global, project])).toBeNull()
    expect(forgetIntent('Forget metric units in this project', [global, project])?.id).toBe(project.id)
    expect(forgetIntent('Forget all preferences', [global])).toBeNull()
  })
})

it('keeps explicit chat-only retention out of project and personal memory', () => {
  expect(rememberIntent('Remember for this chat that the buffer is exactly 100 metres.', true)).toBeNull()
  expect(projectInstruction('For this chat, never modify source data. Buffer distance is exactly 100 metres; working CRS is EPSG:32610.')).toBeNull()
})
