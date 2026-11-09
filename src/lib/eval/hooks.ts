// Seams the skill-training harness uses to drive the PRODUCTION assistant turn.
//
// Every field is undefined in a normal launch. `bridge.ts` fills them only when
// the app was started with OURGEO_EVAL=1 (preload exposes that as
// `electronAPI.evalMode`), so the shipped turn pays one optional-chained call
// per tool and nothing else. The harness measures this code path rather than a
// re-implementation of it, because a re-implementation would measure itself.
// See docs/agent-skill-training-spec.md §4.1.

/** Overlay scalars (contract text, compaction limits). Empty outside eval mode;
 * kept here, import-free, so production modules can read it without pulling
 * the registries `overlay.ts` patches into their import graph. */
export const evalScalars = new Map<string, string | number>()
export function overlayValue<T extends string | number>(key: string, fallback: T): T {
  const value = evalScalars.get(key)
  return (value === undefined ? fallback : value) as T
}

export interface EvalToolCall { id?: string; name: string; input: Record<string, unknown> }

export const evalHooks: {
  /** Return a string to answer the call without running it (probe mode). */
  beforeTool?: (call: EvalToolCall) => string | undefined | Promise<string | undefined>
  afterTool?: (call: EvalToolCall, result: string, ms: number) => void
  /** Registered by AiChatPanel: sends `text` exactly as the Send button does. */
  send?: (text: string) => Promise<void>
  /** The panel's error line. A failed turn says why here and nowhere else. */
  sendError?: string | null
} = {}
