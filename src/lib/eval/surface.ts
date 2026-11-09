// The skill surface: everything ouRGeo authors that reaches a model in an
// assistant turn, as one JSON object with stable keys (spec §2, §4.2).
//
// The keys are the overlay's keys, so a candidate is "this surface with some
// values replaced", budgets and leakage checks read one object, and the
// write-back check compares hashes of a rebuilt app's surface and the accepted
// candidate. Reads the LIVE registries, so an applied overlay shows here too.

import { OURGEO_TOPICS } from '@/lib/ai-skill-ourgeo'
import { buildDocumentSkill } from '@/lib/ai-skill-documents'
import { buildContextContract, buildContextScopeCard } from '@/lib/context/compiler'
import { CONTEXT_TOOLS } from '@/lib/ai-context-tools'
import { UI_TOOLS } from '@/lib/ai-ui-tools'
import { DOC_TOOLS } from '@/lib/ai-doc-tools'
import { WEB_TOOLS } from '@/lib/ai-web-tools'
import { EXECUTE_R_TOOL } from '@/lib/ai-client'
import { actionList } from '@/lib/ai-actions/registry'
import { toolList } from '@/components/toolbox/tools'

export function skillSurface(): Record<string, string> {
  const out: Record<string, string> = {}
  out.contract = buildContextContract({ autoPilot: true, web: true, terminal: true, viaMcp: false })
  out['scopeCard:example'] = buildContextScopeCard({ autoPilot: true, web: false, terminal: false, savedProject: false })
  out['documentSkill'] = buildDocumentSkill({ hasDocumentTools: true })
  for (const [topic, body] of Object.entries(OURGEO_TOPICS)) out[`topic:${topic}:body`] = body
  for (const tool of [...CONTEXT_TOOLS, ...UI_TOOLS, ...DOC_TOOLS, ...WEB_TOOLS, EXECUTE_R_TOOL]) {
    out[`tool:${tool.name}:description`] = tool.description
    for (const [param, schema] of Object.entries((tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>)) {
      if (schema.description) out[`tool:${tool.name}:param:${param}:description`] = schema.description
    }
  }
  for (const action of actionList()) {
    out[`action:${action.id}:summary`] = action.summary
    out[`action:${action.id}:params`] = JSON.stringify(action.params.map(p => ({ name: p.name, type: p.type, required: p.required ?? false, description: p.description, values: p.values })))
    out[`action:${action.id}:tier`] = action.tier
  }
  for (const tool of toolList()) out[`toolbox:${tool.id}:description`] = tool.description
  return out
}
