import { createJsonFileStore } from '@/lib/persistence'

const store = createJsonFileStore('theme.json', 'Theme')

export async function loadTheme(): Promise<string> {
  const data = await store.read<{ theme?: unknown }>()
  return typeof data.theme === 'string' ? data.theme : 'dark'
}

export async function saveTheme(id: string): Promise<void> {
  await store.merge({ theme: id })
}

export async function loadUiScale(): Promise<number> {
  const data = await store.read<{ uiScale?: unknown }>()
  const scale = Number(data.uiScale)
  return Number.isFinite(scale) && scale >= 0.5 && scale <= 2.0 ? scale : 1.0
}

export async function saveUiScale(scale: number): Promise<void> {
  await store.merge({ uiScale: scale })
}
