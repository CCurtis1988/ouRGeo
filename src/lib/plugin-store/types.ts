// What the plugin store looks like from the renderer.
//
// A deliberate copy of the shapes in `electron/preload/types.d.ts` rather than
// an import, for the reason `src/lib/forum/types.ts` gives: that file is
// ambient and belongs to the node tsconfig project, and importing renderer
// modules into it would drag them into the main process's compile.

export interface StoreListing {
  slug: string
  name: string
  summary: string
  category: string
  tags: string[]
  installCount: number
  ratingAvg: number | null
  ratingCount: number
  publishedAt: string
  updatedAt: string
  author: string
  authorAvatar: string | null
  version: string
  ourgeoVersion: string | null
  hasCode: boolean
  permissions: string[]
  iconUrl: string | null
}

export interface StoreCategory {
  slug: string
  name: string
  description: string
  icon: string
}

export interface StoreVersion {
  id: string
  version: string
  status: string
  bytes: number
  sha256: string
  ourgeoVersion: string | null
  permissions: string[]
  hasCode: boolean
  changelog: string | null
  submittedAt: string
  reviewedAt: string | null
  reviewNotes: string | null
  storagePath: string | null
  sourcePath: string | null
}

export interface StoreDetail {
  slug: string
  name: string
  summary: string
  description: string | null
  category: string
  tags: string[]
  homepage: string | null
  repository: string | null
  license: string | null
  installCount: number
  ratingAvg: number | null
  ratingCount: number
  publishedAt: string | null
  updatedAt: string
  isRemoved: boolean
  isMine: boolean
  author: { username: string; displayName: string; avatarUrl: string | null }
  media: { path: string; url: string; alt: string | null; width: number; height: number }[]
  versions: StoreVersion[]
  installedByMe: boolean
  canReview: boolean
  pageUrl: string
}

export interface StoreUpdate {
  slug: string
  latestVersion: string | null
  latestId: string | null
  ourgeoVersion: string | null
  changelog: string | null
  /**
   * The status of the version the user HAS.
   *
   * `'revoked'` is why this field exists: a version that was approved, is out
   * there on people's machines, and has since been found to be a problem. The
   * app switches that plugin off and says why, rather than leaving it running
   * and hoping nobody notices the store no longer lists it.
   */
  installedStatus: string | null
}

export interface StoreReview {
  rating: number
  body: string | null
  created_at: string
  updated_at: string
  author_id: string
}

export interface StoreSubmission {
  slug: string
  name: string
  published_at: string | null
  is_removed: boolean
  install_count: number
  rating_avg: number | null
  versions: {
    id: string
    version: string
    status: string
    submittedAt: string
    reviewedAt: string | null
    reviewNotes: string | null
  }[]
}

/** One screenshot on a plugin's store page. */
export interface StoreMedia {
  id: string
  /** Public CDN url. */
  url: string
  /** Storage path — the key the object is deleted by. */
  path: string
  alt: string | null
  bytes: number
  width: number
  height: number
  sortOrder: number
}

export interface StoreMediaList {
  /**
   * Whether the store has a plugin row for this id yet.
   *
   * Screenshots reference it, so until a first version has been submitted there
   * is nothing to attach one to — which is a rule about ordering, not about the
   * author's account, and the panel says so in those terms.
   */
  claimed: boolean
  /** Whether it is this account's plugin. False means someone else claimed the id. */
  mine: boolean
  items: StoreMedia[]
}

/** How the store is sorted. A closed set, matching `plugin_catalogue()`. */
export type StoreSort = 'popular' | 'rated' | 'new' | 'updated'

export const SORT_LABELS: Record<StoreSort, string> = {
  popular: 'Most installed',
  rated: 'Highest rated',
  new: 'Newest',
  updated: 'Recently updated',
}
