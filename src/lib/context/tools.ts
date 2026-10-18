import type { AiTool } from '@/lib/ai-client'

export function compactToolSchemas(tools: AiTool[], options: { projectFiles?: boolean } = {}): AiTool[] {
  const compact = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(compact)
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'description').map(([key, value]) => [key, compact(value)]))
    return input
  }
  return tools.map(tool => {
    const schema = compact(tool.inputSchema) as AiTool['inputSchema']
    // Projects without a file library do not pay for document location and
    // image schemas on every request. Live dispatch still validates them.
    if (tool.name === 'context_read' && !options.projectFiles && schema.properties) {
      const properties = Object.fromEntries(Object.entries(schema.properties as Record<string, unknown>).filter(([key]) => key !== 'location' && key !== 'visual'))
      return { ...tool, description: tool.description.slice(0, 120), inputSchema: { ...schema, properties } }
    }
    return { ...tool, description: tool.description.slice(0, 120), inputSchema: schema }
  })
}

/** Small windows spend their first schema allocation on discovery. This set
 * stays fixed throughout the tool loop, keeping every exchange valid. */
export function initialToolExposure(tools: AiTool[], window: number, documents: boolean): AiTool[] {
  if (window >= 8192) return tools
  return tools.filter(tool => tool.name.startsWith('context_') || tool.name === 'ourgeo_docs'
    || (documents ? ['read_document', 'write_document', 'edit_document'].includes(tool.name)
      : ['list_ui_actions', 'run_ui_action', 'execute_r_code'].includes(tool.name)))
}
