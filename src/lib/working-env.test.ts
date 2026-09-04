import { describe, it, expect, beforeEach } from 'vitest'
import { setWorkingEnv, workingEnv, pruneWorkingEnv } from './working-env'
import { useSessionStore } from '@/store/session'

function reset(): void {
  useSessionStore.setState({ workingEnv: '.GlobalEnv', consoleHistory: [] })
}

const lastInput = (): string =>
  [...useSessionStore.getState().consoleHistory].reverse()
    .find((e) => e.type === 'input')?.text ?? ''

describe('working in an environment', () => {
  beforeEach(reset)

  it('echoes the R that describes the switch, not a sentence about it', () => {
    // There is no R command that moves the prompt, so the echo is what ouRGeo
    // now does to every command the user types.
    setWorkingEnv('env2')
    expect(lastInput()).toMatch(/^evalq\(\{/)
    expect(lastInput()).toContain('}, env2)')
    expect(workingEnv()).toBe('env2')
  })

  it('echoes the way back the same way', () => {
    setWorkingEnv('env2')
    setWorkingEnv('.GlobalEnv')
    expect(lastInput()).toContain('}, .GlobalEnv)')
  })

  it('says nothing when nothing changed', () => {
    setWorkingEnv('.GlobalEnv')
    expect(useSessionStore.getState().consoleHistory).toHaveLength(0)
  })

  it('drops the setting when the environment is gone, and says so', () => {
    // Otherwise the next command fails with the name of an environment the
    // panel no longer shows.
    setWorkingEnv('env2')
    pruneWorkingEnv(['.GlobalEnv', 'package:stats'])
    expect(workingEnv()).toBe('.GlobalEnv')
    expect(useSessionStore.getState().consoleHistory.at(-1)).toMatchObject({ type: 'info' })
  })

  it('keeps it while the environment is still there', () => {
    setWorkingEnv('env2')
    pruneWorkingEnv(['.GlobalEnv', 'env2'])
    expect(workingEnv()).toBe('env2')
  })
})
