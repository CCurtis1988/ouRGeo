// What the assistant is told about the live session, and — for a provider that
// keeps its own transcript — how little of it has to be said again.
//
// The session state is three blocks: the R environment, the tail of the
// console, and the documents open in the editor. Every transport that posts the
// whole conversation on each turn gets all three every time, because it has no
// prefix to protect and nothing is carried over.
//
// The Claude Code transport is the exception, and the one this module exists
// for. It keeps the transcript itself, so anything sent once STAYS in the
// conversation and is re-read on every turn after — which turns a block that is
// merely large into a bill that compounds. Measured on a twelve-turn
// conversation with Autopilot on, four objects in the environment and two
// documents open, the old all-or-nothing block put **~10,000 tokens** of
// session state into the transcript, and almost all of it was one of two kinds
// of waste:
//
//   * The environment and document blocks were re-sent VERBATIM whenever
//     anything else changed. One console line moving re-sent the full object
//     listing — eleven identical copies, ~2,800 tokens, saying nothing new.
//   * The console tail repeated what the model had just been handed as a TOOL
//     RESULT. With Autopilot on the assistant's own commands are most of the
//     console, so the block was largely the model's own output read back to it.
//
// Hence the two rules here, which are the same rule twice: **say only what has
// changed, and never say what the model already has.** Sections are compared
// independently, and the console is a DELTA — the entries since the last one
// reported, minus the ones the assistant produced itself.
//
// The cost of getting this wrong is silent, which is why the header sentence
// below is written so carefully: a model that reads a partial update as a
// complete replacement concludes that objects have been deleted from the
// session. Every block says exactly what it supersedes.

import type { REnvironmentInfo } from '@/lib/r-client'
import type { ConsoleEntry } from '@/store/session'
import type { TabState } from '@/store/editor'
import { buildEnvContext, buildConsoleContext, describeREnvObject } from '@/lib/ai-client'
import { buildDocumentContext } from '@/lib/ai-doc-context'

export interface SessionInput {
  environments: REnvironmentInfo[]
  consoleHistory: ConsoleEntry[]
  tabs: TabState[]
  activeTabId: string | null
  /**
   * Where the panel's three switches stand, already rendered.
   *
   * Here rather than in the system prompt for the transcript-keeping transport,
   * and only for that one: see `buildToolNaming`. Flipping Autopilot on
   * mid-chat is ordinary, and with the positions in the prompt's tail it cost a
   * full cache write of the conversation every time.
   */
  switches: string
  /**
   * Previews of the objects the user named in THIS message.
   *
   * Never compared and never remembered: the user asked about them in this
   * turn, so they are part of the question rather than part of the state.
   */
  previews: string
}

/**
 * What one chat has already been told. Opaque to callers — build it here, hand
 * it back here.
 *
 * Per chat, because each has its own transcript, and in memory only: a stored
 * mark would outlive the transcript it describes.
 */
export interface SentContext {
  /**
   * `environment::object` → the line last sent for it, or null while the
   * listing has never been reported at all.
   *
   * Per OBJECT rather than per block, because that is the grain at which an
   * environment actually changes: Autopilot creating one result used to re-send
   * the whole listing, and a listing grows, so the twelfth turn of a session
   * re-sent sixteen objects to report the one that was new.
   */
  objects: Record<string, string> | null
  /** The documents block last sent. Compared whole — it is a few lines per open
   *  file, and diffing it would cost more to read than it saves. */
  documents: string | null
  /** The switch positions last stated, so an unflipped switch is silent. */
  switches: string | null
  /**
   * The id of the last console entry already accounted for — INCLUDING the
   * assistant's own, which are skipped rather than pending.
   */
  consoleMark: string | null
}

export const NOTHING_SENT: SentContext =
  { objects: null, documents: null, switches: null, consoleMark: null }

export interface SessionContextResult {
  /** What rides this turn, or `''` when there is nothing to say. */
  block: string
  /** Record this **on success only** — a turn that failed may never have
   *  reached the model, and the next one must not assume it did. */
  sent: SentContext
}

/**
 * How many console entries a first report carries.
 *
 * Only ever used for the opening turn of a conversation and after a
 * `clearConsole`; every turn after that sends a delta, which is normally a
 * handful of lines.
 */
const FIRST_REPORT_ENTRIES = 25

/**
 * The entries the model has not been shown, and the mark to remember.
 *
 * Three cases, and the third is the one worth naming. A mark that is not in the
 * history means the console was cleared out from under it (ids keep counting up
 * across a clear, so the old mark can never match again) — the honest answer is
 * to start over with a capped tail rather than to send nothing and let the
 * model go on believing in output that has been wiped.
 */
export function consoleDelta(
  entries: ConsoleEntry[], mark: string | null,
): { fresh: ConsoleEntry[]; mark: string | null } {
  const last = entries.length > 0 ? entries[entries.length - 1].id : null
  if (entries.length === 0) return { fresh: [], mark }

  const at = mark === null ? -1 : entries.findIndex((e) => e.id === mark)
  const window = (mark !== null && at >= 0)
    ? entries.slice(at + 1)
    : entries.slice(-FIRST_REPORT_ENTRIES)

  // The assistant's own lines are dropped, not deferred: it was handed each of
  // them as a tool result already. The mark still advances past them, or they
  // would be reconsidered — and re-dropped — on every turn for ever.
  return { fresh: window.filter((e) => e.origin !== 'ai'), mark: last }
}

/** What a delta's console block says it is. See `buildConsoleContext`'s `lead`. */
const DELTA_LEAD =
  'New console lines since the last update (most recent last). '
  + 'Earlier lines are still in the console; these are additions, not the whole of it.'

/** Every user object, keyed by environment and name, rendered as the prompt
 *  renders it. The search path is excluded for the reason `buildEnvContext`
 *  excludes it: those objects cannot be named directly in generated R. */
function envObjects(environments: REnvironmentInfo[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const env of environments) {
    if (env.isSearchPath) continue
    for (const obj of env.objects) out[`${env.name}::${obj.name}`] = describeREnvObject(obj)
  }
  return out
}

const envNameOf = (key: string): string => key.slice(0, key.indexOf('::'))
const objNameOf = (key: string): string => key.slice(key.indexOf('::') + 2)

/**
 * What to say about the environment, given what has already been said.
 *
 * The first report is the full listing — the model needs the whole picture
 * once. Every report after it names only the objects that appeared, changed or
 * went away, and says so, because a partial listing read as a complete one is a
 * model telling the user their data has been deleted.
 */
function environmentSection(
  prior: Record<string, string> | null, environments: REnvironmentInfo[],
): string | null {
  const now = envObjects(environments)
  if (prior === null) {
    const full = buildEnvContext(environments)
    return full === '' ? null : full
  }

  const fresh = Object.keys(now).filter((k) => now[k] !== prior[k])
  const gone = Object.keys(prior).filter((k) => !(k in now))
  if (fresh.length === 0 && gone.length === 0) return null

  const lines = [
    '## R Environment — what changed',
    'Only the objects below have changed. Everything else you were told about is still there, unchanged.',
  ]
  if (fresh.length > 0) {
    const byEnv = new Map<string, string[]>()
    for (const k of fresh) {
      const list = byEnv.get(envNameOf(k)) ?? []
      list.push(now[k])
      byEnv.set(envNameOf(k), list)
    }
    lines.push('', 'New or changed:')
    for (const [name, rows] of byEnv) {
      // Named whenever it is not the global environment, even when it is the
      // only one: `myenv$roads` and `roads` are different names in generated R,
      // and a delta that omitted the environment would produce the wrong one.
      if (name !== '.GlobalEnv') lines.push(`### ${name}`)
      lines.push(...rows)
    }
  }
  if (gone.length > 0) {
    lines.push('', `No longer in the session: ${gone.map((k) => {
      const n = objNameOf(k)
      return envNameOf(k) === '.GlobalEnv' ? `\`${n}\`` : `\`${envNameOf(k)}$${n}\``
    }).join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * The whole session state, every turn.
 *
 * For the transports that post the conversation array on each request: they
 * rebuild the prompt from scratch anyway, so there is no prefix to protect and
 * nothing to be gained by sending less than everything.
 */
export function fullSessionContext(input: SessionInput): string {
  const parts = [
    buildEnvContext(input.environments),
    buildConsoleContext(input.consoleHistory),
    buildDocumentContext(input.tabs, input.activeTabId),
    input.previews,
  ].filter(Boolean)
  return parts.join('\n\n')
}

/**
 * Only what has moved since this chat was last told.
 *
 * The header is load-bearing. A model that reads "session state" as a complete
 * picture, having been sent only the console, will conclude that the objects it
 * was told about three turns ago are gone — so the sentence says outright that
 * a section which is absent is a section that has not changed.
 */
export function incrementalSessionContext(
  input: SessionInput, prior: SentContext,
): SessionContextResult {
  const changed: string[] = []

  const envBlock = environmentSection(prior.objects, input.environments)
  if (envBlock) changed.push(envBlock)

  const { fresh, mark } = consoleDelta(input.consoleHistory, prior.consoleMark)
  const consoleBlock = buildConsoleContext(fresh, 25, 4000, DELTA_LEAD)
  if (consoleBlock) changed.push(consoleBlock)

  const docs = buildDocumentContext(input.tabs, input.activeTabId)
  const docBlock = docs === prior.documents
    ? null
    // The last document closing is a change the model has to hear, or it goes
    // on offering to edit a file that is no longer open.
    : (docs === '' ? '## Open Documents\nNo documents are open in the editor.' : docs)
  if (docBlock) changed.push(docBlock)

  // A switch that has moved is the most consequential thing this block can
  // carry — it changes what the assistant may do — so it leads, ahead of the
  // state it applies to.
  if (input.switches !== prior.switches) changed.unshift(input.switches)

  if (input.previews) changed.push(input.previews)

  const sent: SentContext = {
    objects: envObjects(input.environments),
    documents: docs,
    switches: input.switches,
    consoleMark: mark,
  }
  if (changed.length === 0) return { block: '', sent }

  return {
    block: '# Session state — what has changed\n'
      + 'Each section below replaces the previous copy of that SAME section. '
      + 'A section that is not here has not changed; the console block is new lines, not a replacement.\n\n'
      + changed.join('\n\n'),
    sent,
  }
}
