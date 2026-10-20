import { expect, it } from 'vitest'
import { APP_THEME_COLLECTIONS, appThemeCollection } from './theme-collections'
import { BUILTIN_THEME_LIST } from './themes'

it('keeps custom copies separate from the collection and legacy flags inherited from their template', () => {
  expect(appThemeCollection({ custom: true, collection: 'field' })).toBe('custom')
  expect(appThemeCollection({ custom: true, legacy: true })).toBe('custom')
  expect(appThemeCollection(undefined)).toBe('illustrated')
  expect(APP_THEME_COLLECTIONS.map(group => group.label)).toEqual(['Illustrated', 'Legacy', 'Field collection', 'Custom'])
  const counts = Object.fromEntries(APP_THEME_COLLECTIONS.map(group => [group.id, BUILTIN_THEME_LIST.filter(theme => appThemeCollection(theme) === group.id).length]))
  expect(counts).toEqual({ illustrated: 10, legacy: 10, field: 13, custom: 0 })
})
