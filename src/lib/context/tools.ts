import type { AiTool } from '@/lib/ai-client'
import { overlayValue } from '@/lib/eval/hooks'

export function compactToolSchemas(tools: AiTool[], options: { projectFiles?: boolean } = {}): AiTool[] {
  // Eval-mode levers L1 (spec §7.2): description limit and parameter text.
  const limit = overlayValue<number>('compaction:descriptionLimit', 120)
  const keepParams = overlayValue<number>('compaction:paramDescriptions', 0) === 1
  const compact = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(compact)
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).filter(([key]) => keepParams || key !== 'description').map(([key, value]) => [key, compact(value)]))
    return input
  }
  return tools.map(tool => {
    const schema = compact(tool.inputSchema) as AiTool['inputSchema']
    // Projects without a file library do not pay for document location and
    // image schemas on every request. Live dispatch still validates them.
    if (tool.name === 'context_read' && !options.projectFiles && schema.properties) {
      const properties = Object.fromEntries(Object.entries(schema.properties as Record<string, unknown>).filter(([key]) => key !== 'location' && key !== 'visual'))
      return { ...tool, description: tool.description.slice(0, limit), inputSchema: { ...schema, properties } }
    }
    return { ...tool, description: tool.description.slice(0, limit), inputSchema: schema }
  })
}

/** Small windows spend their first schema allocation on discovery. This set
 * stays fixed throughout the tool loop, keeping every exchange valid. */
export function initialToolExposure(tools: AiTool[], window: number, documents: boolean): AiTool[] {
  // Eval lever L3 (spec §7.2): the compact set regardless of window size.
  if (window >= 8192 && overlayValue<string>('exposure:profile', 'window') !== 'compact') return tools
  return tools.filter(tool => tool.name.startsWith('context_') || tool.name === 'ourgeo_docs' || tool.name === 'use_skill' || tool.name === 'save_skill'
    || (documents ? ['read_document', 'write_document', 'edit_document'].includes(tool.name)
      : ['list_ui_actions', 'run_ui_action', 'execute_r_code'].includes(tool.name)))
}
