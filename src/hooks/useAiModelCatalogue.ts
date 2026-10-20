import { useCallback, useEffect, useMemo } from 'react'
import { useAiStore, type AiProvider } from '@/store/ai'
import { useApiKeysStore } from '@/store/apiKeys'
import { useAiTaskModelsStore } from '@/store/ai-task-models'
import { useAiModelCatalogueStore, EMPTY_DISCOVERY } from '@/store/ai-model-catalogue'
import { useChatGptStore } from '@/store/chatgpt'
import { modelCatalogue } from '@/lib/ai-model-catalogue'
import { isLocalProvider, localApiKey, localBaseUrl } from '@/lib/ai-client'

/** All three pickers observe the same saved choices and live discoveries.
 * Merely choosing a task never signs in, adds an account or changes chat. */
export function useAiModelCatalogue(provider: AiProvider, selected = '', enabled = true) {
  const preferred = useAiStore(state => state.modelByProvider[provider])
  const chats = useAiStore(state => state.chats)
  const tasks = useAiTaskModelsStore(state => state.selections)
  const keys = useApiKeysStore(state => state.keys)
  const keysReady = useApiKeysStore(state => state.initialized)
  const discovery = useAiModelCatalogueStore(state => state.discoveries[provider] ?? EMPTY_DISCOVERY)
  const subscriptionModels = useChatGptStore(state => state.models)
  const subscriptionLoading = useChatGptStore(state => state.loading)
  const subscriptionError = useChatGptStore(state => state.error)
  const subscriptionStatus = useChatGptStore(state => state.status)
  const local = isLocalProvider(provider), subscription = provider === 'openai-subscription'
  const url = local ? localBaseUrl(provider, keys) : '', key = local ? localApiKey(provider, keys) : ''
  const refresh = useCallback(async (force = true) => {
    if (local) await useAiModelCatalogueStore.getState().refresh(provider, url, key, force)
    else if (subscription) await useChatGptStore.getState().refresh()
  }, [local, subscription, provider, url, key])
  useEffect(() => {
    if (enabled && keysReady !== false && (local || subscription)) void refresh(false)
  }, [enabled, keysReady, local, subscription, refresh])
  const models = useMemo(() => modelCatalogue({ provider, selected, preferred, chats, tasks: Object.values(tasks), discovered: subscription ? subscriptionModels : local ? discovery.models : [] }), [provider, selected, preferred, chats, tasks, subscription, subscriptionModels, local, discovery.models])
  const accountIssue = subscriptionError || (subscriptionStatus?.signingIn ? 'Complete ChatGPT sign-in under Provider & model.'
    : subscriptionStatus && !subscriptionStatus.signedIn ? 'Sign in with ChatGPT under Provider & model; file tasks reuse that connection.'
      : subscriptionStatus && !subscriptionStatus.planEnabled ? 'Enable ChatGPT plan usage under Provider & model for the existing account.' : null)
  return { models, loading: subscription ? !!subscriptionLoading : local && discovery.loading, error: subscription ? accountIssue : local ? discovery.error : null, refresh, canRefresh: local || subscription }
}
