import { create } from 'zustand'

interface HelpStore {
  isOpen: boolean
  toggleOpen: () => void
  setOpen: (v: boolean) => void
}

export const useHelpStore = create<HelpStore>((set) => ({
  isOpen: false,
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setOpen: (v) => set({ isOpen: v }),
}))
