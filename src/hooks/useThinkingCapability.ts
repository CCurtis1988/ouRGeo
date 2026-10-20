import { useEffect, useState } from 'react'
import type { AiProvider } from '@/store/ai'
import { thinkingCapability, ollamaThinkingCapability, type ThinkingCapability } from '@/lib/ai-thinking'
import { proxyFetch } from '@/lib/ai-proxy-fetch'

/** Discovery is tied to the connection, not just its model name. A response
 * from the old server must never supply controls for the newly selected one. */
export function useThinkingCapability(provider: AiProvider, model: string, localUrl?: string, apiKey?: string): ThinkingCapability | null {
  const [discovered, setDiscovered] = useState<{ identity: string; capability: ThinkingCapability | null } | null>(null)
  const identity = JSON.stringify([provider, model, localUrl, apiKey])
  useEffect(() => {
    if (provider !== 'ollama' || !model || !localUrl) return
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await proxyFetch(`${localUrl.replace(/\/$/, '')}/api/show`, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({ model }),
        })
        const capability = response.ok ? ollamaThinkingCapability(await response.json(), model) : null
        if (!controller.signal.aborted) setDiscovered({ identity, capability })
      } catch { if (!controller.signal.aborted) setDiscovered({ identity, capability: null }) }
    })()
    return () => controller.abort()
  }, [provider, model, localUrl, apiKey, identity])
  return provider === 'ollama' ? discovered?.identity === identity ? discovered.capability : null : thinkingCapability(provider, model)
}
