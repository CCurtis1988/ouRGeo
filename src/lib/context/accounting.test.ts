import { describe, expect, it } from 'vitest'
import { buildOurgeoCore } from '@/lib/ai-skill-ourgeo'
import { AI_BASE_PROMPT, buildProvenanceRules, buildToolGuidance } from '@/lib/ai-system-prompt'
import { buildDocumentSkill } from '@/lib/ai-skill-documents'
import { UI_TOOLS } from '@/lib/ai-ui-tools'
import { DOC_TOOLS } from '@/lib/ai-doc-tools'
import { WEB_TOOLS } from '@/lib/ai-web-tools'
import { CONTEXT_TOOLS } from '@/lib/ai-context-tools'
import { EXECUTE_R_TOOL } from '@/lib/ai-client'
import { fullSessionContext } from '@/lib/ai-session-context'
import { buildContextContract, buildContextScopeCard } from './compiler'
import { compactToolSchemas } from './tools'
import { estimateTokens } from './budget'
import { routeContext } from './router'
import { writeFileSync } from 'node:fs'

describe('local-only context accounting fixture v1', () => {
  it('measures the legacy counterfactual without making a duplicate inference call', () => {
    const switches = { autoPilot: true, webAccess: true, terminal: false }
    const legacySystem = [AI_BASE_PROMPT, buildOurgeoCore(), buildProvenanceRules(), buildDocumentSkill({ hasDocumentTools: true }), buildToolGuidance(switches)].join('\n\n')
    const oldTools = [...UI_TOOLS, ...DOC_TOOLS, ...WEB_TOOLS, EXECUTE_R_TOOL]
    const contract = buildContextContract({ autoPilot: true, web: true, terminal: false, viaMcp: false })
    const newTools = compactToolSchemas([...CONTEXT_TOOLS, ...oldTools])
    const smallLegacy = estimateTokens({ system: legacySystem, tools: oldTools })
    const scopeCard = buildContextScopeCard({ autoPilot: true, web: true, terminal: false, savedProject: false })
    const efficient = estimateTokens({ system: contract, tools: newTools, scopeCard })
    const environments = [{ name: '.GlobalEnv', isSearchPath: false, objects: Array.from({ length: 10000 }, (_, i) => ({ name: `unrelated_${i}`, class: 'data.frame', dim: [100, 3], size: 4000, length: 3, preview: '100 observations', isEnvironment: false, isList: false })) }]
    const giantLegacy = estimateTokens(fullSessionContext({ environments, consoleHistory: [], tabs: [], activeTabId: null, switches: '', previews: '' })) + smallLegacy
    expect(routeContext('Generate 100 rows of dummy data.').topics).toEqual([])
    expect(efficient).toBeLessThan(smallLegacy)
    expect(efficient).toBeLessThanOrEqual(smallLegacy * 0.3)
    expect(estimateTokens(contract)).toBeLessThanOrEqual(1200)
    const metrics = { fixture: 'context-accounting-v1', estimated: true, legacyEmptyWorkspaceNonDialogue: smallLegacy, brokerNonDialogue: efficient, brokerToolSchemas: estimateTokens(newTools), legacy10000ObjectsNonDialogue: giantLegacy, brokerAuxiliaryTokens: 0, emptyWorkspaceReductionPercent: Math.round((1 - efficient / smallLegacy) * 100), giantWorkspaceReductionPercent: Math.round((1 - efficient / giantLegacy) * 100) }
    console.info(JSON.stringify(metrics))
    if (process.env.OURGEO_CONTEXT_ACCOUNTING_PATH) writeFileSync(process.env.OURGEO_CONTEXT_ACCOUNTING_PATH, JSON.stringify(metrics, null, 2) + '\n')
  })
})
