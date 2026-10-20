import type { ThemeDef } from '@/lib/themes'

export const APP_THEME_COLLECTIONS = [
  { id: 'illustrated', label: 'Illustrated' },
  { id: 'legacy', label: 'Legacy' },
  { id: 'field', label: 'Field collection' },
  { id: 'custom', label: 'Custom' },
] as const
export type AppThemeCollection = typeof APP_THEME_COLLECTIONS[number]['id']

/** Origin wins over the template: a user's copy of a Field or Legacy theme
 * belongs to Custom, even if it still carries its parent's presentation flags. */
export function appThemeCollection(theme: Pick<ThemeDef, 'custom' | 'legacy' | 'collection'> | undefined): AppThemeCollection {
  if (theme?.custom) return 'custom'
  if (theme?.legacy) return 'legacy'
  return theme?.collection === 'field' ? 'field' : 'illustrated'
}
