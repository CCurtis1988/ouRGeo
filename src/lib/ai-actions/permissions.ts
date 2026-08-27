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
  | { allowed: false; reason: 'confirm' }

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

/** Whether an action may run right now. */
export function checkAllowed(action: UiAction, opts: { autoPilot: boolean }): Decision {
  const tier = resolveTier(action)
  if (tier === 'always') return { allowed: true }
  if (!opts.autoPilot) {
    return {
      allowed: false,
      reason: 'autopilot',
      message:
        `Refused: "${action.id}" needs Autopilot, which is off. Tell the user what you wanted ` +
        'to do and that they can switch Autopilot on in the AI panel, or ask them to do it ' +
        'themselves — you can still point at the control with ui.highlight.',
    }
  }
  if (tier === 'confirm') return { allowed: false, reason: 'confirm' }
  return { allowed: true }
}
