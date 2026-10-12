import { describe, expect, it, vi } from 'vitest'
import { routeSkillDescriptors } from './router'

vi.mock('@/lib/ai-actions/registry', () => ({ actionIndex: () => '' }))
import { topicDescriptors, OURGEO_TOPICS } from '@/lib/ai-skill-ourgeo'

describe('built-in discovery vocabulary', () => {
  it.each([
    ['Use a palette with accessible contrast.', 'themes'],
    ['Changer le thème de l’application.', 'themes'],
    ['Cambiar el tema de colores del editor.', 'themes'],
    ['Render a notebook with reproducible results.', 'documents'],
    ['Crear un informe reproducible.', 'documents'],
    ['Compiler un rapport reproductible.', 'documents'],
  ])('discovers the %s workflow without fetching its body', (text, topic) => {
    expect(routeSkillDescriptors(text, topicDescriptors())).toContain(topic)
  })
  it('keeps a context-free request free of built-in alias matches and bounds local metadata', () => {
    const descriptors = topicDescriptors()
    expect(routeSkillDescriptors('Generate 100 rows of dummy data.', descriptors)).toEqual([])
    for (const descriptor of descriptors) {
      expect(descriptor.triggers.length).toBeLessThanOrEqual(32)
      expect(descriptor.triggers.every(trigger => trigger.length <= 128)).toBe(true)
      expect(descriptor.summary).not.toBe(OURGEO_TOPICS[descriptor.topic])
    }
    const themes = descriptors.find(descriptor => descriptor.topic === 'themes')!
    expect(themes.triggers).toContain('palette')
    expect(routeSkillDescriptors('Explain colour theory using a palette.', descriptors)).not.toContain('themes')
  })
})
