import { describe, it, expect, beforeEach } from 'vitest'
import { BUILTIN_ACTIONS, actionById, listActions } from './registry'
import { checkAllowed, clearTierOverrides, setTierOverride } from './permissions'
import { validateArgs } from './types'

const terminalActions = BUILTIN_ACTIONS.filter((a) => a.group === 'terminal')

const ON = { autoPilot: true, terminal: true }
const NO_TERMINAL = { autoPilot: true, terminal: false }
const NO_AUTOPILOT = { autoPilot: false, terminal: true }

beforeEach(() => { clearTierOverrides() })

describe('the terminal group', () => {
  it('is registered, and every action is in it', () => {
    expect(terminalActions.length).toBeGreaterThan(0)
    for (const a of terminalActions) expect(a.id.startsWith('terminal:')).toBe(true)
  })

  it('covers opening, running, reading, interrupting, closing and listing', () => {
    const ids = terminalActions.map((a) => a.id).sort()
    expect(ids).toEqual([
      'terminal:close', 'terminal:interrupt', 'terminal:list',
      'terminal:open', 'terminal:read', 'terminal:run',
    ])
  })

  it('gates every one of them on the Terminal switch', () => {
    // On the ACTION, not inside each handler: a rule enforced at every call
    // site holds only until someone adds a seventh action.
    for (const a of terminalActions) {
      expect(a.requires, a.id).toBe('terminal')
    }
  })

  it('needs no confirmation dialog, because the switch is the deliberate act', () => {
    // The user turned shell access on once, on purpose. A modal per command
    // on top of that is a habit-forming click rather than a decision — and the
    // user can still raise any of these to `confirm` in the permissions dialog.
    for (const a of terminalActions) expect(a.tier).not.toBe('confirm')
  })
})

describe('the two switches', () => {
  const run = () => actionById('terminal:run')!

  it('refuses with the Terminal switch off, and names that switch', () => {
    const d = checkAllowed(run(), NO_TERMINAL)
    // Narrowed rather than asserted: the `confirm` arm carries no message, so
    // the union is what makes reading one here a type error.
    expect(d.allowed === false && d.reason === 'requires').toBe(true)
    if (d.allowed || d.reason !== 'requires') return
    // The refusal has to name the way out, and the fallback that still works.
    expect(d.message).toContain('Terminal switch')
    expect(d.message).toContain('execute_r_code')
  })

  it('names the missing switch first when both are off', () => {
    // Two refusals for one call is how a model ends up telling a user
    // something is impossible: the more specific answer goes first.
    const d = checkAllowed(run(), { autoPilot: false, terminal: false })
    expect(d.allowed).toBe(false)
    if (d.allowed) return
    expect(d.reason).toBe('requires')
  })

  it('still needs Autopilot once the Terminal switch is on', () => {
    const d = checkAllowed(run(), NO_AUTOPILOT)
    expect(d.allowed).toBe(false)
    if (d.allowed) return
    expect(d.reason).toBe('autopilot')
  })

  it('allows the action with both on', () => {
    expect(checkAllowed(run(), ON)).toEqual({ allowed: true })
  })

  it('gates the read-only actions on the switch too, tier notwithstanding', () => {
    // `terminal:list` is `always`, which without the requirement check would
    // let a model enumerate the user's shells with the switch off.
    const list = actionById('terminal:list')!
    expect(list.tier).toBe('always')
    expect(checkAllowed(list, NO_TERMINAL).allowed).toBe(false)
    expect(checkAllowed(list, ON).allowed).toBe(true)
  })

  it('still honours a tier the user raised', () => {
    setTierOverride('terminal:run', 'confirm')
    const d = checkAllowed(run(), ON)
    expect(d.allowed).toBe(false)
    if (d.allowed) return
    expect(d.reason).toBe('confirm')
  })
})

describe('what the model can discover', () => {
  it('lists the terminal actions when the switch is on', () => {
    expect(listActions('terminal', undefined, ON)).toContain('terminal:run')
  })

  it('hides them entirely when it is off', () => {
    // Absent rather than declined afterwards — the same rule the web tools
    // follow. Discovering a capability and then being refused it costs the
    // model a turn and the user a confusing sentence.
    const listing = listActions('terminal', undefined, NO_TERMINAL)
    expect(listing).not.toContain('terminal:run')
    expect(listing).not.toContain('terminal:open')
  })

  it('leaves every other group visible with the switch off', () => {
    expect(listActions('panel', undefined, NO_TERMINAL)).toContain('ui:panel')
  })
})

describe('arguments, validated before anything runs', () => {
  it('requires a command to run', () => {
    expect(validateArgs(actionById('terminal:run')!, {})).toMatch(/command/)
  })

  it('accepts a command with no terminal named, meaning the active tab', () => {
    expect(validateArgs(actionById('terminal:run')!, { command: 'ls' })).toBeNull()
  })

  it('takes no arguments at all for a listing', () => {
    expect(validateArgs(actionById('terminal:list')!, {})).toBeNull()
  })

  it('refuses a multi-line command before it reaches a shell', async () => {
    // Only the first line would be measured by the completion marker; the rest
    // would run unwatched and unreported.
    const res = await actionById('terminal:run')!.run({ command: 'cd /tmp\nrm -rf x' })
    expect(res.ok).toBe(false)
    expect(res.message).toContain('one command at a time')
  })
})
