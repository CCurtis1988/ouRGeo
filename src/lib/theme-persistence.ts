import { createJsonFileStore } from '@/lib/persistence'
import { THEMES } from '@/lib/themes'
import { CODE_THEMES, MARKDOWN_THEMES } from '@/lib/editor-themes'

const store = createJsonFileStore('theme.json', 'Theme')

export async function loadTheme(): Promise<string> {
  const data = await store.read<{ theme?: unknown }>()
  return typeof data.theme === 'string' ? data.theme : 'dark'
}

export async function saveTheme(id: string): Promise<void> {
  await store.merge({ theme: id })
}

/** The code and markdown editor themes, validated against the registries so a
 *  stale id (a theme that shipped once and was renamed) falls back to the app
 *  theme's default rather than leaving the editor unstyled. */
export async function loadEditorThemes(
  systemThemeId: string,
): Promise<{ codeTheme: string; markdownTheme: string }> {
  const data = await store.read<{ codeTheme?: unknown; markdownTheme?: unknown }>()
  const sys = THEMES[systemThemeId] ?? THEMES.dark
  const code = typeof data.codeTheme === 'string' && data.codeTheme in CODE_THEMES
    ? data.codeTheme : sys.defaultCodeTheme
  const md = typeof data.markdownTheme === 'string' && data.markdownTheme in MARKDOWN_THEMES
    ? data.markdownTheme : sys.defaultMarkdownTheme
  return { codeTheme: code, markdownTheme: md }
}

export async function saveCodeTheme(id: string): Promise<void> {
  await store.merge({ codeTheme: id })
}

export async function saveMarkdownTheme(id: string): Promise<void> {
  await store.merge({ markdownTheme: id })
}

export async function loadUiScale(): Promise<number> {
  const data = await store.read<{ uiScale?: unknown }>()
  const scale = Number(data.uiScale)
  return Number.isFinite(scale) && scale >= 0.5 && scale <= 2.0 ? scale : 1.0
}

export async function saveUiScale(scale: number): Promise<void> {
  await store.merge({ uiScale: scale })
}
