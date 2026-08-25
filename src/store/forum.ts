import { create } from 'zustand'
import type { ForumProfile, ForumCategory } from '@/lib/forum/types'

// Forum sign-in state.
//
// Deliberately holds no tokens. Authentication lives entirely in the main
// process (electron/main/forum.ts) — this store knows only who is signed in and
// what they are allowed to do, so nothing here could leak a posting credential.

/** Where a Publish run has got to, for the dialog's progress line. */
export type PublishPhase =
  | { kind: 'idle' }
  | { kind: 'knitting' }
  | { kind: 'uploading'; done: number; total: number }
  | { kind: 'posting' }
  | { kind: 'done'; url: string }
  | { kind: 'error'; message: string }

interface ForumState {
  profile: ForumProfile | null
  categories: ForumCategory[]
  /** True while restore/sign-in is in flight. */
  busy: boolean
  phase: PublishPhase
  setProfile: (p: ForumProfile | null) => void
  setCategories: (c: ForumCategory[]) => void
  setBusy: (b: boolean) => void
  setPhase: (p: PublishPhase) => void
}

export const useForumStore = create<ForumState>((set) => ({
  profile: null,
  categories: [],
  busy: false,
  phase: { kind: 'idle' },
  setProfile: (profile) => set({ profile }),
  setCategories: (categories) => set({ categories }),
  setBusy: (busy) => set({ busy }),
  setPhase: (phase) => set({ phase }),
}))

/** Trust level at which uploading a figure is allowed. Mirrors the schema. */
export const UPLOAD_TRUST_LEVEL = 1

/** Can this account attach figures to a post? */
export function canUploadImages(p: ForumProfile | null): boolean {
  if (!p) return false
  if (p.role === 'moderator' || p.role === 'admin') return true
  return p.trustLevel >= UPLOAD_TRUST_LEVEL
}

/** Why not, as a sentence — mirrors the trigger's own wording. */
export function uploadBlockedReason(p: ForumProfile | null): string | null {
  if (canUploadImages(p)) return null
  return 'Uploading figures unlocks at trust level 1 — three posts over two days. ' +
    'You can publish the text now and add the figures later.'
}
