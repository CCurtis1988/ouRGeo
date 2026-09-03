import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../ui/button'

// Asked before an object goes onto the map a second time.
//
// A second layer from one object is legitimate — two symbologies of the same
// roads, one labelled and one not — so this is a question, not a refusal. But
// it is far more often a user who forgot the layer was already there, and the
// two are indistinguishable from inside the app: nothing about the click says
// which one was meant.
//
// Hence three answers, not two. "Show existing" is the one the forgetful case
// actually wants and the only one the old flow could not express: it selects
// the layer that is already there and moves the map to it, so the user ends up
// looking at their data instead of at a duplicate they now have to remove.
//
// Shared by the data viewer's Add to Map button and the Environment panel's
// Send to spatial editor, so the same click gets the same answer wherever the
// user starts from.

interface Props {
  /** The object being sent — null when nothing is pending. */
  name: string | null
  /** How many layers already show it. */
  count: number
  onCancel: () => void
  onShowExisting: () => void
  onAddAgain: () => void
}

export function AlreadyOnMapDialog({
  name, count, onCancel, onShowExisting, onAddAgain,
}: Props): React.ReactElement | null {
  if (!name) return null

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] bg-geo-panel border border-geo-border rounded-lg shadow-xl">
          <div className="px-4 py-3 border-b border-geo-border">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              Already on the map
            </Dialog.Title>
          </div>

          <div className="px-4 py-3 space-y-2">
            <p className="text-sm text-foreground">
              <span className="font-medium">{name}</span> is already
              {count > 1 ? ` ${count} layers` : ' a layer'} in the spatial editor.
            </p>
            <p className="text-xs text-geo-muted">
              Adding it again makes a separate layer of the same R object — useful for a
              second symbology, and otherwise just a duplicate.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-geo-border">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="ghost" size="sm" onClick={onShowExisting}>
              Show existing layer
            </Button>
            <Button
              size="sm"
              onClick={onAddAgain}
              className="bg-geo-accent hover:bg-geo-accent/80 text-white"
              data-ourgeo-id="map.addAgain"
            >
              Add again
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
