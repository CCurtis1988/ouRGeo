import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { skillSurface } from './surface'
import { applyOverlay, restoreOverlay } from './overlay'
import { buildContextContract } from '@/lib/context/compiler'
import { compactToolSchemas } from '@/lib/context/tools'
import { UI_TOOLS } from '@/lib/ai-ui-tools'
import { toolList } from '@/components/toolbox/tools'
import { uiTargets } from '@/lib/ai-actions/targets'
import { themeList } from '@/lib/themes'
import { buildOurgeoCore } from '@/lib/ai-skill-ourgeo'

describe('skill surface and overlay', () => {
  it('exports every trainable module', () => {
    const surface = skillSurface()
    expect(surface.contract.length).toBeGreaterThan(1000)
    expect(Object.keys(surface).filter(k => k.startsWith('topic:')).length).toBeGreaterThanOrEqual(20)
    expect(Object.keys(surface).filter(k => k.endsWith(':summary')).length).toBeGreaterThanOrEqual(170)
    // `SKILL_SURFACE_OUT=path npx vitest run src/lib/eval` writes it for the harness.
    if (process.env.SKILL_SURFACE_OUT) fs.writeFileSync(process.env.SKILL_SURFACE_OUT, JSON.stringify(surface, null, 1))
    // The catalogue task authors write oracles against (ids, fields, targets).
    if (process.env.SKILL_CATALOGUE_OUT) fs.writeFileSync(process.env.SKILL_CATALOGUE_OUT, JSON.stringify({
      toolbox: toolList().map(t => ({ id: t.id, label: t.label, fields: t.fields.map(f => ({ id: f.id, label: f.label, type: f.type, options: (f as { options?: { value: string }[] }).options?.map(o => o.value) })) })),
      targets: uiTargets().map(t => ({ id: t.id, label: t.label })),
      themes: themeList().map(t => ({ id: t.id, label: t.label, isDark: t.isDark })),
      // Not shipped to any model today (spec H2); exported for lever L2.
      unusedCore: buildOurgeoCore(),
    }, null, 1))
  })
  it('applies and fully restores a candidate', () => {
    const before = JSON.stringify(skillSurface())
    applyOverlay({ 'topic:maps:body': 'X', 'tool:run_ui_action:description': 'Y', 'action:map:addLayer:summary': 'Z', 'scalar:contract': 'C', 'scalar:compaction:descriptionLimit': 400 })
    const during = skillSurface()
    expect(during['topic:maps:body']).toBe('X')
    expect(during['action:map:addLayer:summary']).toBe('Z')
    expect(buildContextContract({ autoPilot: false, web: false, terminal: false, viaMcp: false })).toBe('C')
    expect(compactToolSchemas(UI_TOOLS).find(t => t.name === 'run_ui_action')!.description).toBe('Y')
    restoreOverlay()
    expect(JSON.stringify(skillSurface())).toBe(before)
  })
  it('refuses an unknown key rather than silently doing nothing', () => {
    expect(() => applyOverlay({ 'action:map:noSuchThing:summary': 'x' })).toThrow('Unknown overlay key')
    restoreOverlay()
  })
})
