import { create } from 'zustand'
import type { AppUpdateStatus, UpdatePreferences, InstallerFormat } from '@/lib/app-updates'
interface State {
  status: AppUpdateStatus | null
  checking: boolean
  error: string | null
  startupOffer: boolean
  allowStartupOffer: boolean
  init: () => Promise<void>
  check: (mode: 'startup' | 'manual') => Promise<void>
  preferences: (patch: Partial<UpdatePreferences>) => Promise<void>
  dismissStartup: () => void
  open: (destination: InstallerFormat | 'downloads' | 'notes') => Promise<void>
}
let initializing: Promise<void> | undefined
let checking: Promise<void> | undefined
export const useAppUpdatesStore = create<State>((set, get) => ({
  status: null, checking: false, error: null, startupOffer: false, allowStartupOffer: true,
  init: () => {
    if (get().status || !window.electronAPI.updates) return Promise.resolve()
    if (!initializing) initializing = window.electronAPI.updates.status().then(status => { if (!get().status) set({ status }) }).catch(() => { set({ error: 'Update settings could not be loaded. Try checking again.' }) }).finally(() => { initializing = undefined })
    return initializing
  },
  check: mode => {
    if (mode === 'manual') set({ startupOffer: false, allowStartupOffer: false })
    if (checking) return checking
    set({ checking: true, error: null })
    checking = window.electronAPI.updates.check(mode).then(status => {
      set({ status, checking: false, startupOffer: mode === 'startup' && get().allowStartupOffer && status.preferences.automatic && status.state === 'available' && status.latestVersion !== status.preferences.skippedVersion })
    }).catch(() => { set({ checking: false, error: 'The update check could not finish. Check your connection and try again.', startupOffer: false }) }).finally(() => { checking = undefined })
    return checking
  },
  preferences: async patch => {
    try { const status = await window.electronAPI.updates.preferences(patch); set({ status, error: null, ...(!status.preferences.automatic ? { startupOffer: false } : {}) }) }
    catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); throw error }
  },
  dismissStartup: () => set({ startupOffer: false, allowStartupOffer: false }),
  open: async destination => {
    try { await window.electronAPI.updates.open(destination); set({ error: null }) }
    catch { const message = 'The browser could not open the official update page. Try again, or visit ourgeo.dev/ourgeo-download.html.'; set({ error: message }); throw new Error(message) }
  },
}))
