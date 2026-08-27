// The contract every GUI action the assistant can perform is written against.
//
// One registry of data objects rather than one AI tool per operation: there are
// ~90 things a user can do from the ouRGeo interface, and no model — least of
// all a local one — copes with 90 tool definitions in its context. The registry
// is searched with `list_ui_actions` and invoked with `run_ui_action`, so the
// model pays for the ones it is actually using.
//
// Same shape as the toolbox's ToolDef and the markdown action catalog: pure
// data plus one function, so the whole surface is enumerable, testable, and
// documentable without an app running.

/**
 * How much permission an action needs.
 *
 *  - `always`    — navigation and reading. Opening a panel, listing layers,
 *                  pointing at a button. Nothing in the R session or on disk
 *                  changes, so there is nothing to gate.
 *  - `autopilot` — touches R state, the filesystem, or the user's data. Gated
 *                  by the same switch as `execute_r_code`, because it is the
 *                  same kind of power.
 *  - `confirm`   — destructive or hard to undo: removing an object, resetting
 *                  the session, overwriting a file, discarding a dirty project.
 *                  Needs Autopilot *and* an explicit click.
 *
 * These are DEFAULTS. The user reassigns any action to any tier from the gear
 * beside the Autopilot switch — see permissions.ts.
 */
export type Tier = 'always' | 'autopilot' | 'confirm'

export const TIERS: Tier[] = ['always', 'autopilot', 'confirm']

export const TIER_LABELS: Record<Tier, string> = {
  always: 'Always allowed',
  autopilot: 'Needs Autopilot',
  confirm: 'Needs confirmation',
}

export type GroupId =
  | 'ui' | 'editor' | 'project' | 'data' | 'environment' | 'packages'
  | 'help' | 'map' | 'draw' | 'plots' | 'session' | 'settings'

export const GROUP_LABELS: Record<GroupId, string> = {
  ui: 'Panels & dialogs',
  editor: 'Editor & files',
  project: 'Projects',
  data: 'Data import & databases',
  environment: 'R environment',
  packages: 'Packages',
  help: 'Help',
  map: 'Spatial editor',
  draw: 'Drawing & geometry editing',
  plots: 'Plots',
  session: 'Session & console',
  settings: 'Settings',
}

export type ParamType = 'string' | 'number' | 'boolean' | 'enum' | 'strings' | 'numbers' | 'json'

export interface ParamDef {
  name: string
  type: ParamType
  /** Written for the model: what it means, not what it is. */
  description: string
  required?: boolean
  /** Allowed values for `enum`. */
  values?: readonly string[]
  /** Shown in listings so the model knows what happens if it omits the param. */
  default?: string | number | boolean
}

export type Args = Record<string, unknown>

export interface ActionResult {
  ok: boolean
  /** One line the model can quote back to the user. */
  message: string
  /** Structured payload for listing actions. */
  data?: unknown
}

export interface UiAction {
  id: string
  group: GroupId
  /** One line. Shown in `list_ui_actions` and in the permissions dialog. */
  summary: string
  params: ParamDef[]
  tier: Tier
  run: (args: Args) => Promise<ActionResult> | ActionResult
}

// ── Result helpers ─────────────────────────────────────────────────────────

export function ok(message: string, data?: unknown): ActionResult {
  return { ok: true, message, data }
}

export function fail(message: string): ActionResult {
  return { ok: false, message }
}

// ── Argument access ────────────────────────────────────────────────────────
//
// Every accessor coerces rather than throws. Tool arguments arrive as JSON a
// model wrote, so `"3"` for a number and `"true"` for a boolean are routine;
// failing the call over that would be pedantry the user pays for.

export function argStr(args: Args, name: string, fallback = ''): string {
  const v = args[name]
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return fallback
}

export function argNum(args: Args, name: string, fallback: number): number {
  const v = args[name]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

export function argNumOrNull(args: Args, name: string): number | null {
  const v = args[name]
  if (v === undefined || v === null || v === '') return null
  const n = argNum(args, name, NaN)
  return Number.isFinite(n) ? n : null
}

export function argBool(args: Args, name: string, fallback = false): boolean {
  const v = args[name]
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase()
    if (['true', 'yes', '1', 'on'].includes(t)) return true
    if (['false', 'no', '0', 'off'].includes(t)) return false
  }
  if (typeof v === 'number') return v !== 0
  return fallback
}

/** A list, however the model expressed it: array, or a comma-separated string. */
export function argList(args: Args, name: string): string[] {
  const v = args[name]
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s !== '')
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean)
  return []
}

export function argNumList(args: Args, name: string): number[] {
  return argList(args, name).map(Number).filter((n) => Number.isFinite(n))
}

/** A JSON-ish value, whether it arrived parsed or as a string. */
export function argJson(args: Args, name: string): unknown {
  const v = args[name]
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return undefined }
}

/** A bbox in [west, south, east, north] order, or null. */
export function argBbox(args: Args, name: string): [number, number, number, number] | null {
  const nums = Array.isArray(args[name])
    ? (args[name] as unknown[]).map(Number)
    : argNumList(args, name)
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return null
  return [nums[0], nums[1], nums[2], nums[3]]
}

// ── Validation ─────────────────────────────────────────────────────────────

/** Missing required params and bad enum values, as one message — or null.
 *  Returned to the model as a tool result so it can correct itself. */
export function validateArgs(action: UiAction, args: Args): string | null {
  const problems: string[] = []
  for (const p of action.params) {
    const raw = args[p.name]
    const missing = raw === undefined || raw === null || raw === ''
    if (p.required && missing) {
      problems.push(`"${p.name}" is required (${p.description})`)
      continue
    }
    if (missing) continue
    if (p.type === 'enum' && p.values && !p.values.includes(String(raw))) {
      problems.push(`"${p.name}" must be one of: ${p.values.join(', ')} — got "${String(raw)}"`)
    }
    if (p.type === 'number' && !Number.isFinite(Number(raw))) {
      problems.push(`"${p.name}" must be a number — got "${String(raw)}"`)
    }
  }
  if (problems.length === 0) return null
  return `Invalid arguments for ${action.id}: ${problems.join('; ')}.`
}

/** One line describing an action for `list_ui_actions`. */
export function describeAction(action: UiAction, tier: Tier): string {
  const params = action.params.length === 0
    ? ''
    : ` — params: ${action.params.map((p) => {
        const bits = [p.name, p.type === 'enum' && p.values ? `(${p.values.join('|')})` : `(${p.type})`]
        if (p.required) bits.push('*required*')
        return `${bits.join(' ')}: ${p.description}`
      }).join('; ')}`
  return `${action.id} [${tier}] — ${action.summary}${params}`
}
