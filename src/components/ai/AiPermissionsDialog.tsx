import React, { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, ChevronRight, Search, RotateCcw } from 'lucide-react'
import { Button } from '../ui/button'
import { useAiStore } from '@/store/ai'
import { actionList } from '@/lib/ai-actions/registry'
import { usePluginRevision } from '@/store/plugins'
import { resolveTier } from '@/lib/ai-actions/permissions'
import { TIERS, groupLabel, type Tier, type UiAction } from '@/lib/ai-actions/types'
import { cn } from '@/lib/utils'

/**
 * Which of the assistant's interface actions need what.
 *
 * Every action ships with a default tier; this is where the user disagrees with
 * one. Overrides are stored sparse, so an action left alone keeps following the
 * default even if a later release changes it — which is why the rows show
 * "(default)" rather than pretending every value is a choice.
 */

const TIER_HINT: Record<Tier, string> = {
  always: 'Runs whenever the assistant asks.',
  autopilot: 'Runs only while Autopilot is on.',
  confirm: 'Asks you every time, and needs Autopilot.',
}

function TierPicker({
  value, isDefault, onChange,
}: {
  value: Tier
  isDefault: boolean
  onChange: (t: Tier) => void
}): React.ReactElement {
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {TIERS.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          title={TIER_HINT[t]}
          className={cn(
            'text-[10px] px-1.5 py-0.5 rounded border transition-colors',
            value === t
              ? t === 'confirm'
                ? 'bg-geo-error/15 border-geo-error/40 text-geo-error'
                : t === 'autopilot'
                  ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-400'
                  : 'bg-geo-success/15 border-geo-success/40 text-geo-success'
              : 'border-geo-border text-geo-muted hover:text-foreground'
          )}
        >
          {t === 'always' ? 'Always' : t === 'autopilot' ? 'Autopilot' : 'Confirm'}
        </button>
      ))}
      <span className={cn('text-[9px] w-12 flex-shrink-0', isDefault ? 'text-geo-muted/60' : 'text-geo-accent')}>
        {isDefault ? 'default' : 'changed'}
      </span>
    </div>
  )
}

export function AiPermissionsDialog({
  open, onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const actionTiers = useAiStore((s) => s.actionTiers)
  const setActionTier = useAiStore((s) => s.setActionTier)
  const resetActionTiers = useAiStore((s) => s.resetActionTiers)
  const [query, setQuery] = useState('')
  // Plugin actions belong in this dialog too — the user grants them tiers the
  // same way. The revision is how the list learns a plugin was enabled.
  const revision = usePluginRevision()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byGroup = new Map<string, UiAction[]>()
    for (const a of actionList()) {
      if (q && !a.id.toLowerCase().includes(q) && !a.summary.toLowerCase().includes(q)) continue
      const list = byGroup.get(a.group) ?? []
      list.push(a)
      byGroup.set(a.group, list)
    }
    return byGroup
  }, [query, revision])

  const changedCount = Object.keys(actionTiers).length

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
            w-[640px] max-h-[85vh] flex flex-col
            bg-geo-panel border border-geo-border rounded-lg shadow-xl focus:outline-none"
        >
          <div className="flex items-start justify-between px-5 py-4 border-b border-geo-border shrink-0">
            <div>
              <Dialog.Title className="text-sm font-semibold text-foreground">
                What the assistant may do
              </Dialog.Title>
              <Dialog.Description className="text-[11px] text-geo-muted mt-1">
                The assistant can drive the interface. Decide what it does freely, what waits for
                Autopilot, and what asks you first.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="text-geo-muted hover:text-foreground" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex items-center gap-2 px-5 py-2 border-b border-geo-border shrink-0">
            <div className="relative flex-1">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-geo-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search actions…"
                className="w-full bg-geo-bg border border-geo-border rounded pl-7 pr-2 py-1
                           text-xs text-foreground placeholder:text-geo-muted
                           focus:outline-none focus:border-geo-accent"
              />
            </div>
            <Button
              size="sm" variant="ghost"
              className="h-6 text-[10px] gap-1 text-geo-muted hover:text-foreground"
              disabled={changedCount === 0}
              onClick={resetActionTiers}
            >
              <RotateCcw className="w-3 h-3" />
              Reset {changedCount > 0 ? `(${changedCount})` : ''}
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
            {[...groups.entries()].map(([group, actions]) => {
              const isCollapsed = collapsed.has(group)
              return (
                <div key={group} className="mb-1">
                  <button
                    onClick={() => setCollapsed((prev) => {
                      const next = new Set(prev)
                      if (next.has(group)) next.delete(group)
                      else next.add(group)
                      return next
                    })}
                    className="flex items-center gap-1 w-full px-2 py-1 text-xs font-medium
                               text-foreground hover:bg-white/5 rounded"
                  >
                    <ChevronRight className={cn('w-3 h-3 transition-transform', !isCollapsed && 'rotate-90')} />
                    {groupLabel(group)}
                    <span className="text-[10px] text-geo-muted">({actions.length})</span>
                  </button>
                  {!isCollapsed && actions.map((a) => {
                    const override = actionTiers[a.id]
                    return (
                      <div
                        key={a.id}
                        className="flex items-center gap-3 pl-7 pr-2 py-1 hover:bg-white/5 rounded"
                      >
                        <div className="min-w-0 flex-1">
                          <code className="text-[11px] font-mono text-geo-accent">{a.id}</code>
                          <p className="text-[10px] text-geo-muted truncate">{a.summary}</p>
                        </div>
                        <TierPicker
                          value={resolveTier(a)}
                          isDefault={!override}
                          onChange={(t) => setActionTier(a.id, t === a.tier ? null : t)}
                        />
                      </div>
                    )
                  })}
                </div>
              )
            })}
            {groups.size === 0 && (
              <p className="text-xs text-geo-muted px-2 py-4 text-center">No actions match “{query}”.</p>
            )}
          </div>

          <div className="px-5 py-2 border-t border-geo-border shrink-0">
            <p className="text-[10px] text-geo-muted">
              Whatever the tier, every action the assistant performs is logged to the R console.
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
