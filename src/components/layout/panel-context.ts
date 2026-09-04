// Which panel a component is being drawn in.
//
// With one editor and one map this question never had to be asked: a component
// read `useEditorStore.activeTabId` and there was only one answer. With two, a
// `CodeEditor` has to know whether it is `editor` or `editor#2` before it can
// say which tabs it shows — and it cannot be told by a prop, because nothing
// between `Zone` and it knows either.
//
// Context rather than a prop chain for exactly that reason, and the fallback
// is the ORIGINAL panel's id rather than null: `CodeEditor` and `SpatialEditor`
// are also mounted outside a zone (a test, a future popout window), and there
// the honest answer is "the only one there is".
//
// A .ts file with no component in it: `Zone` renders the provider inline. A
// `PanelIdProvider` component here would make this a mixed module, which costs
// React Fast Refresh for every consumer.

import { createContext, useContext } from 'react'
import type { PanelId } from '@/lib/layout/model'

export const PanelIdContext = createContext<PanelId | null>(null)

/** The panel this component is inside, or `fallback` when it is not in one. */
export function usePanelId(fallback: PanelId): PanelId {
  return useContext(PanelIdContext) ?? fallback
}
