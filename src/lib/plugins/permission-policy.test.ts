import { expect, it } from 'vitest'
import { pluginPermissionsApproved } from './permission-policy'

it('preserves legacy permissions without inferring consent to context sharing', () => {
  expect(pluginPermissionsApproved(['service', 'network'], undefined)).toBe(true)
  expect(pluginPermissionsApproved(['service', 'context-source'], undefined)).toBe(false)
  expect(pluginPermissionsApproved(['network', 'context-source'], ['network'])).toBe(false)
  expect(pluginPermissionsApproved(['context-source'], ['context-source'])).toBe(true)
})
it('fails closed for damaged grants and unsupported permission categories', () => {
  for (const grants of [null, 'context-source', {}, ['context-source', 1], ['everything']]) expect(pluginPermissionsApproved(['context-source'], grants)).toBe(false)
  expect(pluginPermissionsApproved(['everything'], ['everything'])).toBe(false)
})
