// The skill overlay: a candidate skill surface applied to the LIVE registries.
//
// Rebuilding the app per candidate would make the training loop slow without
// making it more faithful — production reads these same objects — so in eval
// mode a candidate arrives as a patch keyed `<kind>:<id>:<field>` and is written
// into the registries in place. `restoreOverlay` puts every original back, so
// one app instance can run baseline and candidate episodes alternately.
//
// The overlay never ships: an accepted candidate is written into the source and
// the final evaluation runs with no overlay at all (spec §4.2).

import { OURGEO_TOPICS } from '@/lib/ai-skill-ourgeo'
import { CONTEXT_TOOLS } from '@/lib/ai-context-tools'
import { UI_TOOLS } from '@/lib/ai-ui-tools'
import { DOC_TOOLS } from '@/lib/ai-doc-tools'
import { WEB_TOOLS } from '@/lib/ai-web-tools'
import { EXECUTE_R_TOOL, type AiTool } from '@/lib/ai-client'
import { actionById } from '@/lib/ai-actions/registry'
import { toolList } from '@/components/toolbox/tools'
import { evalScalars } from './hooks'

export type SkillOverlay = Record<string, string | number | null>

const undo: (() => void)[] = []

function allTools(): AiTool[] {
  return [...CONTEXT_TOOLS, ...UI_TOOLS, ...DOC_TOOLS, ...WEB_TOOLS, EXECUTE_R_TOOL]
}

function setField<T extends object>(target: T, field: string, value: unknown): void {
  const record = target as Record<string, unknown>
  const had = Object.prototype.hasOwnProperty.call(record, field), before = record[field]
  if (value === null) delete record[field]; else record[field] = value
  undo.push(() => { if (had) record[field] = before; else delete record[field] })
}

/** Apply a candidate. Unknown keys throw: a typo must not look like "no effect". */
export function applyOverlay(overlay: SkillOverlay): void {
  restoreOverlay()
  for (const [key, value] of Object.entries(overlay)) {
    const [kind, ...rest] = key.split(':')
    if (kind === 'scalar') { if (value !== null) evalScalars.set(rest.join(':'), value); continue }
    if (kind === 'topic') {
      const [topic, field] = [rest[0], rest[1]]
      if (field !== 'body' || !(topic in OURGEO_TOPICS) && value === null) throw new Error(`Unknown overlay key ${key}`)
      setField(OURGEO_TOPICS, topic, value)
      continue
    }
    if (kind === 'tool') {
      const [name, ...path] = rest
      const tool = allTools().find(t => t.name === name)
      if (!tool) throw new Error(`Unknown overlay key ${key}`)
      if (path[0] === 'description') { setField(tool, 'description', value); continue }
      if (path[0] === 'param' && path[2] === 'description') {
        const property = (tool.inputSchema.properties as Record<string, Record<string, unknown>>)[path[1]]
        if (!property) throw new Error(`Unknown overlay key ${key}`)
        setField(property, 'description', value)
        continue
      }
      throw new Error(`Unknown overlay key ${key}`)
    }
    if (kind === 'action') {
      // Action ids contain a colon themselves: action:map:addLayer:summary
      const field = rest.at(-1)!, id = rest.slice(0, -1).join(':')
      const action = actionById(id)
      if (!action) throw new Error(`Unknown overlay key ${key}`)
      if (field === 'summary') { setField(action, 'summary', value); continue }
      throw new Error(`Unknown overlay key ${key}`)
    }
    if (kind === 'toolbox') {
      const [id, field] = rest
      const tool = toolList().find(t => t.id === id)
      if (!tool || field !== 'description') throw new Error(`Unknown overlay key ${key}`)
      setField(tool, 'description', value)
      continue
    }
    throw new Error(`Unknown overlay key ${key}`)
  }
}

export function restoreOverlay(): void {
  while (undo.length) undo.pop()!()
  evalScalars.clear()
}
