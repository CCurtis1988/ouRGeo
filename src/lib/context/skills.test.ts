import { expect, it } from 'vitest'
import { validateSkills } from './skills'

const skill = (id: string, over = {}) => ({ id, summary: `Guidance ${id}`, bodyFile: `skills/${id}.md`, ...over })
const manifest = (skills: unknown[], over = {}) => ({ version: 1, required: ['skill-sections', 'skill-dependencies'], skills, ...over })
it('preserves addressable sections, local dependencies and app compatibility without adding authority', () => {
  const result = validateSkills(manifest([skill('units'), skill('flood', { dependsOn: ['units'], ourgeoVersion: '>=1.16.19', sections: [{ id: 'safety', summary: 'Buffer units and limits', bodyFile: 'skills/safety.md', required: true }] })]))
  expect(result.skills[1]).toMatchObject({ dependsOn: ['units'], ourgeoVersion: '>=1.16.19', sections: [{ id: 'safety', required: true }] })
  expect(() => validateSkills(manifest([skill('flood', { trust: 'host' })]))).toThrow('host trust')
})
it('requires old-host rejection for new skill capabilities', () => {
  expect(() => validateSkills(manifest([skill('flood', { dependsOn: ['units'] })], { required: ['skills'] }))).toThrow('skill-dependencies')
  expect(() => validateSkills(manifest([skill('flood', { sections: [] })], { required: ['skills'] }))).toThrow('skill-sections')
})
it('rejects missing, foreign and cyclic dependencies before any plugin runs', () => {
  expect(() => validateSkills(manifest([skill('flood', { dependsOn: ['absent'] })]))).toThrow('missing')
  expect(() => validateSkills(manifest([skill('flood', { dependsOn: ['another:units'] })]))).toThrow('local skills')
  expect(() => validateSkills(manifest([skill('flood', { dependsOn: ['units'] }), skill('units', { dependsOn: ['flood'] })]))).toThrow('cycle')
})
it('rejects duplicate sections and files escaping the plugin', () => {
  const section = { id: 'safety', summary: 'Safety', bodyFile: 'skills/safety.md' }
  expect(() => validateSkills(manifest([skill('flood', { sections: [section, section] })]))).toThrow('unique')
  expect(() => validateSkills(manifest([skill('flood', { sections: [{ ...section, bodyFile: '../private.md' }] })]))).toThrow('inside the plugin')
})
