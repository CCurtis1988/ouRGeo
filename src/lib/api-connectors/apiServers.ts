// Per-provider server registry. Each API provider ships built-in servers and lets
// users add their own (persisted to a small JSON file per provider). Generalized
// from the CKAN portal store.

import { create, type UseBoundStore, type StoreApi } from 'zustand'
import { createJsonFileStore } from '@/lib/persistence'
import type { ApiServer } from './types'

/** Normalize a base URL: trim, ensure scheme, strip trailing slash. */
export function normalizeServerUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '')
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`
  return u
}

interface PersistShape { servers?: ApiServer[] }

export interface ServerState {
  servers: ApiServer[]
  initialized: boolean
  init: () => Promise<void>
  /** Validate (via the provider's `validate`) then persist a custom server. */
  addServer: (label: string, baseUrl: string, validate?: (url: string) => Promise<unknown>) => Promise<ApiServer>
  removeServer: (id: string) => void
}

const storeCache = new Map<string, UseBoundStore<StoreApi<ServerState>>>()

/** Returns a memoized Zustand store bound to a provider's persisted server list. */
export function getServerStore(
  providerId: string, builtins: ApiServer[],
): UseBoundStore<StoreApi<ServerState>> {
  const existing = storeCache.get(providerId)
  if (existing) return existing

  const file = createJsonFileStore(`api-servers-${providerId}.json`, `API Servers (${providerId})`)
  const builtinList = builtins.map((b) => ({ ...b, builtin: true }))

  const store = create<ServerState>((set, get) => ({
    servers: builtinList,
    initialized: false,

    init: async () => {
      if (get().initialized) return
      const data = await file.read<PersistShape>()
      const custom = Array.isArray(data.servers) ? data.servers.filter((s) => !s.builtin) : []
      set({ servers: [...builtinList, ...custom], initialized: true })
    },

    addServer: async (label, baseUrl, validate) => {
      const url = normalizeServerUrl(baseUrl)
      if (!url) throw new Error('Enter a server URL.')
      if (get().servers.some((s) => normalizeServerUrl(s.baseUrl) === url)) {
        throw new Error('That server is already in the list.')
      }
      if (validate) await validate(url)
      const server: ApiServer = {
        id: `custom-${Date.now()}`,
        label: label.trim() || url.replace(/^https?:\/\//, ''),
        baseUrl: url,
      }
      const next = [...get().servers, server]
      set({ servers: next })
      file.write({ servers: next.filter((s) => !s.builtin) })
      return server
    },

    removeServer: (id) => {
      const next = get().servers.filter((s) => s.id !== id || s.builtin)
      set({ servers: next })
      file.write({ servers: next.filter((s) => !s.builtin) })
    },
  }))

  storeCache.set(providerId, store)
  return store
}
