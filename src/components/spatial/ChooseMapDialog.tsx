// "Send roads to which map?"
//
// Rendered once, as a sibling of the other dialogs in EditorLayout, and driven
// entirely by `useMapTargetStore` — so the four places that send an object to
// the map ask the same question in the same words, and none of them has to
// carry a dialog of its own.

import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Map as MapIcon } from 'lucide-react'
import { useMapTargetStore } from '@/store/mapTarget'
import { useGeometryEditStore, sessionsForPanel } from '@/store/geometryEdit'
import { panelInfo } from '@/lib/layout/panel-meta'
import { useSpatialSettingsStore } from '@/store/spatialSettings'
import { saveSpatialSettings } from '@/lib/spatial-settings-persistence'

export function ChooseMapDialog(): React.ReactElement | null {
  const request = useMapTargetStore((s) => s.request)
  const answer = useMapTargetStore((s) => s.answer)
  const sessions = useGeometryEditStore((s) => s.namedSessions)
  const setMapTarget = useSpatialSettingsStore((s) => s.setMapTarget)
  const settings = useSpatialSettingsStore()
  if (!request) return null

  const remember = (): void => {
    setMapTarget('last')
    void saveSpatialSettings(settings.initialExtentMode, settings.userExtent)
  }

  return (
    <Dialog.Root
      open
      // Dismissing is a "no": nothing is added, and the caller's await
      // resolves to null rather than hanging.
      onOpenChange={(open) => { if (!open) answer(null) }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
          w-[26rem] bg-geo-panel border border-geo-border rounded-lg shadow-xl p-5 flex flex-col gap-4">
          <Dialog.Title className="text-sm font-semibold text-foreground">
            Send to which map?
          </Dialog.Title>
          <Dialog.Description className="text-xs text-geo-muted">
            <span className="text-foreground">{request.what}</span> can go to either Spatial Editor.
          </Dialog.Description>

          <div className="flex flex-col gap-1.5">
            {request.panels.map((p) => {
              // Which session it will join, so the choice is between two real
              // maps rather than between two identical labels.
              const here = sessionsForPanel(sessions, p)
              const n = here.length
              return (
                <button
                  key={p}
                  className="flex items-center gap-2 px-3 py-2 rounded border border-geo-border
                    text-left hover:bg-geo-bg hover:border-geo-accent transition-colors"
                  onClick={() => answer(p)}
                >
                  <MapIcon className="w-3.5 h-3.5 text-geo-accent flex-shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-foreground">{panelInfo(p)?.label ?? p}</span>
                    <span className="block text-[11px] text-geo-muted">
                      {n === 0 ? 'No sessions yet' : `${n} session${n === 1 ? '' : 's'}`}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="flex items-center justify-between">
            <button
              className="text-[11px] text-geo-muted hover:text-foreground underline underline-offset-2"
              onClick={remember}
              title="Settings → Spatial Editor can switch this back"
            >
              Always use the map I last worked in
            </button>
            <Dialog.Close asChild>
              <button className="px-3 py-1.5 text-xs rounded border border-geo-border text-foreground hover:bg-geo-bg">
                Cancel
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
