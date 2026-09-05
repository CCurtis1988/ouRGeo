// Who decides what the assistant may do.
//
// Every action ships with a default tier, and the user can move any action to
// any tier from the gear beside the Autopilot switch. Overrides are stored
// SPARSE — only the actions the user actually changed — so the defaults stay
// live: a later release can retighten a default without silently overriding a
// choice the user made, and without a migration.
//
// The gate itself is deliberately the same one that governs `execute_r_code`.
// An action that imports a file or deletes an object is not a lesser power than
// running R; presenting it as a separate switch would let a user turn Autopilot
// off and still be surprised.

import type { Tier, UiAction } from './types'

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: 'autopilot'; message: string }
  | { allowed: false; reason: 'requires'; message: string }
  | { allowed: false; reason: 'confirm' }

/** The switches in force when an action is asked to run. */
export interface Switches {
  autoPilot: boolean
  /** The Terminal switch in the AI panel footer. Off by default. */
  terminal: boolean
}

/** Sparse map of user overrides, actionId → tier. */
export type TierOverrides = Record<string, Tier>

let overrides: TierOverrides = {}

/** Replace the override map (called once from the AI store on load). */
export function setTierOverrides(next: TierOverrides): void {
  overrides = { ...next }
}

export function getTierOverrides(): TierOverrides {
  return { ...overrides }
}

/** Move one action to a tier, or back to its default with `null`. */
export function setTierOverride(actionId: string, tier: Tier | null): TierOverrides {
  const next = { ...overrides }
  if (tier === null) delete next[actionId]
  else next[actionId] = tier
  overrides = next
  return { ...next }
}

export function clearTierOverrides(): void {
  overrides = {}
}

/** The tier in force for an action: the user's choice, else the default. */
export function resolveTier(action: UiAction): Tier {
  return overrides[action.id] ?? action.tier
}

/**
 * Whether an action may run right now.
 *
 * The extra requirement is checked FIRST, and before the tier, because it is
 * the more specific answer: an action the user has not enabled at all should
 * say so, rather than telling them to turn on Autopilot and then refusing
 * again for a different reason. Two refusals for one call is how a model ends
 * up telling a user something is impossible.
 */
export function checkAllowed(action: UiAction, opts: Switches): Decision {
  if (action.requires === 'terminal' && !opts.terminal) {
    return {
      allowed: false,
      reason: 'requires',
      message:
        `Refused: "${action.id}" needs the Terminal switch, which is off. It sits in the AI ` +
        'panel footer beside Autopilot, and both must be on before you can run shell commands. ' +
        'Say what you wanted to run and that they can switch it on; you may still point at the ' +
        'Terminal panel with ui:highlight, and anything that can be done in R you can still do ' +
        'with execute_r_code.',
    }
  }
  const tier = resolveTier(action)
  if (tier === 'always') return { allowed: true }
  if (!opts.autoPilot) {
    return {
      allowed: false,
      reason: 'autopilot',
      message:
        `Refused: "${action.id}" needs Autopilot, which is off. Say what you wanted to do and ` +
        'that they can switch Autopilot on in the AI panel, or name the button that does the ' +
        'same thing and point at it with ui:highlight — you may still do that. Do NOT write ' +
        'the action id out as R code for them to run: it is not a function, and it will only ' +
        'produce "could not find function".',
    }
  }
  if (tier === 'confirm') return { allowed: false, reason: 'confirm' }
  return { allowed: true }
}
