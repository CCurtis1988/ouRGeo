// Talking to the plugin store.
//
// Thin wrappers over the `store:*` IPC, so nothing in the UI reaches for
// `window.electronAPI` directly and every call has one place to be found. The
// interesting part is `storeErrorMessage`, which is `forumErrorMessage`'s
// sibling and exists for the same reason: Electron wraps a main-process throw
// as "Error invoking remote method 'store:install': Error: <the real message>",
// and the real message is the one the schema wrote for a person to read.

import type {
  StoreCategory, StoreDetail, StoreListing, StoreReview, StoreSort, StoreSubmission, StoreUpdate,
} from './types'
import type { StoreOrigin } from '@/lib/plugins/store-origin'

const REMOTE_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/

export function storeErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(REMOTE_PREFIX, '')
}

export interface CatalogueQuery {
  query?: string
  category?: string
  tag?: string
  sort?: StoreSort
  limit?: number
  offset?: number
}

export function accountStatus(): Promise<{
  hasStoredToken: boolean
  signedIn: boolean
  profile: { id: string; username: string; displayName: string; role: string } | null
}> {
  return window.electronAPI.store.accountStatus()
}

export function categories(): Promise<StoreCategory[]> {
  return window.electronAPI.store.categories()
}

export function catalogue(q: CatalogueQuery): Promise<StoreListing[]> {
  return window.electronAPI.store.catalogue(q)
}

export function detail(slug: string): Promise<StoreDetail | null> {
  return window.electronAPI.store.detail(slug)
}

export function updates(installed: { slug: string; version: string }[]): Promise<StoreUpdate[]> {
  return window.electronAPI.store.updates(installed)
}

export function install(slug: string, versionId: string): Promise<StoreOrigin> {
  return window.electronAPI.store.install({ slug, versionId })
}

export function reviews(slug: string): Promise<StoreReview[]> {
  return window.electronAPI.store.reviews(slug)
}

export function writeReview(slug: string, rating: number, body?: string): Promise<void> {
  return window.electronAPI.store.writeReview({ slug, rating, body })
}

export function deleteReview(slug: string): Promise<void> {
  return window.electronAPI.store.deleteReview(slug)
}

export function mySubmissions(): Promise<StoreSubmission[]> {
  return window.electronAPI.store.mine()
}

export function isModerator(): Promise<boolean> {
  return window.electronAPI.store.isModerator()
}
