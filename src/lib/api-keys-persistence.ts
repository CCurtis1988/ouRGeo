import { createJsonFileStore } from '@/lib/persistence'

const store = createJsonFileStore('api-keys.json', 'ApiKeys')

export async function loadApiKeys(): Promise<Record<string, string>> {
  const data = await store.read<Record<string, string>>()
  return typeof data === 'object' && data !== null ? data : {}
}

export async function saveApiKey(id: string, value: string): Promise<void> {
  await store.merge({ [id]: value })
}
