// "Which map?" — asked once, answered once, resolved back to the caller.
//
// Sending an object to the map is a one-line call from four places (the
// Environment panel, the data viewer, the assistant, the connectors), and with
// two Spatial Editors every one of them has a question to ask first. Making
// each of those places own a dialog would give four dialogs that could drift;
// making the choice a setting would take it away from anyone who wants to
// decide per object.
//
// So the question is a promise. `chooseMapPanel` (lib/map-target.ts) parks a
// request here, `ChooseMapDialog` renders it, and the answer resolves the
// promise the caller is already awaiting. Closing the dialog answers `null` —
// the safe answer must be the one you get by doing nothing, the same rule the
// AI permission modal follows.

import { create } from 'zustand'
import type { PanelId } from '@/lib/layout/model'

export interface MapTargetRequest {
  /** What is being sent, so the dialog can name it. */
  what: string
  panels: PanelId[]
  resolve: (panel: PanelId | null) => void
}

interface MapTargetState {
  request: MapTargetRequest | null
  ask: (what: string, panels: PanelId[]) => Promise<PanelId | null>
  answer: (panel: PanelId | null) => void
}

export const useMapTargetStore = create<MapTargetState>((set, get) => ({
  request: null,

  ask: (what, panels) => new Promise<PanelId | null>((resolve) => {
    // A second question while one is open would strand the first caller
    // waiting for ever. Answering it `null` cancels that send cleanly.
    get().request?.resolve(null)
    set({ request: { what, panels, resolve } })
  }),

  answer: (panel) => {
    const req = get().request
    if (!req) return
    set({ request: null })
    req.resolve(panel)
  },
}))
