// Renderer-side shapes for the forum API.
//
// A deliberate mirror of the interfaces in electron/preload/types.d.ts rather
// than a shared import: the preload declarations are ambient and belong to the
// node tsconfig project, and reaching across would break the project boundary
// the way electron/main/knit.ts once did. `PlotPopoutState` is mirrored the
// same way in src/store/plotting.ts.

/** A signed-in forum account, as the main process reports it. */
export interface ForumProfile {
  id: string
  username: string
  displayName: string
  role: string
  trustLevel: number
  bytesUsed: number
  quota: number
  bannedUntil: string | null
}

export interface ForumCategory {
  slug: string
  name: string
  description: string
  icon: string
  minRoleToPost: string
}
