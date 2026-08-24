import { createJsonFileStore } from '@/lib/persistence'

const store = createJsonFileStore('basemap.json', 'Basemap')

export async function loadBasemap(): Promise<string | null> {
  const data = await store.read<{ overrideBasemapId?: unknown }>()
  return typeof data.overrideBasemapId === 'string' ? data.overrideBasemapId : null
}

export async function saveBasemap(id: string | null): Promise<void> {
  await store.write({ overrideBasemapId: id })
}
