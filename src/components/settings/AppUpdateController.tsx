import { usePanelDragStore } from '@/store/panelDrag'
import { useContentDragStore } from '@/store/contentDrag'
import { useEffect } from 'react'
import { useAppUpdatesStore } from '@/store/app-updates'
import { useUiStore } from '@/store/ui'
import { useProjectStore } from '@/store/project'

/** Optional release checks never hold up R/session restoration. A discovered
 * update waits its turn rather than replacing a health check, picker or modal. */
export function AppUpdateController(): null {
  const offer = useAppUpdatesStore(state => state.startupOffer)
  useEffect(() => {
    if (!window.electronAPI.updates) return
    const timer = window.setTimeout(() => { void useAppUpdatesStore.getState().check('startup') }, 3000)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (!offer) return
    const show = (): void => {
      if (!useAppUpdatesStore.getState().startupOffer || useUiStore.getState().openDialog || useUiStore.getState().confirm || useProjectStore.getState().phase === 'loading' || usePanelDragStore.getState().panel || usePanelDragStore.getState().pending || useContentDragStore.getState().drag || document.querySelector('[role="dialog"], [data-drop-panel]')) return
      useAppUpdatesStore.getState().dismissStartup()
      useUiStore.getState().showDialog('app-update')
    }
    show()
    const timer = window.setInterval(show, 1000)
    return () => window.clearInterval(timer)
  }, [offer])
  return null
}
