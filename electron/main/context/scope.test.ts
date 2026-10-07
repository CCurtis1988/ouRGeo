import { describe, expect, it } from 'vitest'
import { activateContextProject, closeContextProject, contextLease, requireProjectLease } from './scope'

describe('host-issued project leases', () => {
  it('does not let a caller replace the active namespace or reuse an old lease after switching', () => {
    const projectId = crypto.randomUUID()
    activateContextProject(projectId)
    const first = contextLease()
    expect(() => requireProjectLease(projectId, first.id)).not.toThrow()
    expect(() => requireProjectLease(crypto.randomUUID(), first.id)).toThrow('SCOPE_CHANGED')
    activateContextProject(projectId)
    expect(() => requireProjectLease(projectId, first.id)).toThrow('SCOPE_CHANGED')
    closeContextProject(contextLease().id)
    expect(contextLease().projectId).toBeNull()
    expect(() => requireProjectLease(projectId, contextLease().id)).toThrow('SCOPE_CHANGED')
  })
})
