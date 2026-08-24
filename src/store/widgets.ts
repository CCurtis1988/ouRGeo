import { create } from 'zustand'

interface Widget {
  id: string
  addedAt: number
}

interface WidgetsState {
  isOpen: boolean
  widgets: Widget[]
  currentIndex: number
  addWidget(id: string): void
  goBack(): void
  goForward(): void
  ensureOpen(): void
}

export const useWidgetsStore = create<WidgetsState>((set) => ({
  isOpen: false,
  widgets: [],
  currentIndex: -1,

  addWidget: (id) =>
    set((s) => {
      const widgets = [...s.widgets, { id, addedAt: Date.now() }]
      return { widgets, currentIndex: widgets.length - 1, isOpen: true }
    }),

  goBack: () => set((s) => ({ currentIndex: Math.max(0, s.currentIndex - 1) })),
  goForward: () =>
    set((s) => ({ currentIndex: Math.min(s.widgets.length - 1, s.currentIndex + 1) })),
  ensureOpen: () => set((s) => (s.isOpen ? {} : { isOpen: true })),
}))
