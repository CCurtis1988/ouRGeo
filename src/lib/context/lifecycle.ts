import { usePluginStore } from '@/store/plugins'
import { useContextStore } from '@/store/context'
import { useAiStore } from '@/store/ai'
import { clearResultCache } from './result-cache'

/** Keep revocation active even while the chat panel is closed. A provider-held
 * transcript cannot have a removed plugin's bytes edited out in place. */
export function setupContextLifecycle(): () => void {
  const plugins = usePluginStore.subscribe((state, previous) => {
    if (state.revision === previous.revision) return
    useAiStore.getState().cancelStream()
    useContextStore.getState().revokeDelivery()
  })
  const chats = useAiStore.subscribe((state, previous) => {
    if (state.chats === previous.chats) return
    for (const chat of previous.chats) if (!state.chats.some(current => current.id === chat.id)) clearResultCache(chat.id)
  })
  return () => { plugins(); chats(); clearResultCache() }
}
