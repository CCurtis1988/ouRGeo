import { useAiStore } from '@/store/ai'
import { clearResultCache } from '@/lib/context/result-cache'
import { create } from 'zustand'
import { useProjectStore } from '@/store/project'
import { useLayoutStore } from '@/store/layout'
import type { ProjectFileLocation } from '@/lib/project-files'

interface QueuedProjectFile { id: string; location?: ProjectFileLocation; projectId: string; workspaceEpoch: number }
export const useProjectFileAttachmentQueue = create<{ requests: QueuedProjectFile[] }>(() => ({ requests: [] }))

let initialised = false
/** Provider transcripts cannot be edited to replace an earlier document's
 * bytes. Reconstruct them from portable chat after a library revision. Active
 * turns cancel separately only when they actually selected the changed file. */
export function initProjectFileAiInvalidation(): void {
  if (initialised) return
  initialised = true
  window.addEventListener('ourgeo:attachProjectFile', event => {
    const detail = (event as CustomEvent<{ id: string; location?: ProjectFileLocation }>).detail
    const project = useProjectStore.getState()
    if (!detail?.id || !project.projectId) return
    useProjectFileAttachmentQueue.setState({ requests: [{ ...detail, projectId: project.projectId, workspaceEpoch: project.workspaceEpoch }] })
    const layout = useLayoutStore.getState()
    layout.setPanelOpen('ai', true)
    layout.setActivePanel('ai')
    layout.focusPanel('ai')
  })
  window.addEventListener('ourgeo:projectFilesRevised', () => {
    clearResultCache()
    useAiStore.setState(state => ({ chats: state.chats.map(chat => chat.claudeSessionId || chat.lastSessionContext ? { ...chat, claudeSessionId: null, lastSessionContext: null } : chat) }))
  })
}
