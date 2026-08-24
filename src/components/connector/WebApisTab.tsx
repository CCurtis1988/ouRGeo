import React, { useState } from 'react'
import { ApiConnectorBrowser } from './ApiConnectorBrowser'
import { API_PROVIDERS, providersByCategory } from '@/lib/api-connectors/registry'
import { cn } from '@/lib/utils'

interface Props {
  onClose: () => void
}

/** The "Web APIs" tab: a category-grouped provider picker on top, and the selected
 *  provider's connector browser below. */
export function WebApisTab({ onClose }: Props): React.ReactElement {
  const [providerId, setProviderId] = useState(API_PROVIDERS[0]?.id ?? '')
  const provider = API_PROVIDERS.find((p) => p.id === providerId) ?? API_PROVIDERS[0] ?? null
  const groups = providersByCategory()

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      {/* Category-grouped provider picker */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1.5 px-4 py-2 border-b border-geo-border flex-shrink-0 bg-geo-bg">
        {groups.map((g) => (
          <div key={g.category} className="flex flex-col gap-1">
            <span className="text-[9px] font-semibold text-geo-muted uppercase tracking-wider">{g.category}</span>
            <div className="flex flex-wrap gap-1">
              {g.providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProviderId(p.id)}
                  title={p.description}
                  className={cn(
                    'px-2 py-0.5 text-[11px] rounded-full whitespace-nowrap transition-colors border',
                    p.id === providerId
                      ? 'bg-geo-accent text-white border-geo-accent'
                      : 'bg-geo-panel border-geo-border text-geo-muted hover:text-foreground hover:border-geo-accent/50',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Active provider browser (key forces a clean remount per provider) */}
      {provider
        ? <ApiConnectorBrowser key={provider.id} provider={provider} onClose={onClose} />
        : <div className="flex-1 flex items-center justify-center text-xs text-geo-muted">No API providers configured.</div>}
    </div>
  )
}
