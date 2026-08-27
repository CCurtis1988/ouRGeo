import { create } from 'zustand'

/**
 * A navigation the panel has been asked to perform from outside — the console's
 * `?topic`, or the AI assistant opening documentation mid-tutorial.
 *
 * A *request*, not a view: HelpPanel owns its history stack and does the fetch,
 * so an external caller says where to go rather than assembling a HelpView it
 * would have to fetch the HTML for. The panel clears it once handled, which is
 * also what makes the same request twice in a row work.
 */
export type HelpRequest =
  | { kind: 'search'; query: string }
  | { kind: 'doc'; topic: string; pkg?: string }
  | { kind: 'package'; pkg: string }
  | { kind: 'vignette'; pkg: string; name: string }
  | { kind: 'home' }

interface HelpStore {
  isOpen: boolean
  requested: HelpRequest | null
  toggleOpen: () => void
  setOpen: (v: boolean) => void
  /** Open the panel and navigate it. */
  request: (r: HelpRequest) => void
  clearRequest: () => void
}

export const useHelpStore = create<HelpStore>((set) => ({
  isOpen: false,
  requested: null,
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setOpen: (v) => set({ isOpen: v }),
  request: (requested) => set({ isOpen: true, requested }),
  clearRequest: () => set({ requested: null }),
}))
