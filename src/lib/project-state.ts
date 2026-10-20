// The parts of a project's working state that are neither documents, map
// layers, plots, the console nor chats — which already have their own
// persistence modules — but that a project must still bring back exactly
// (docs/project-persistence-spec.md §1.1): the map's named sessions, geometry
// edits staged but not yet written to R, R's working directory and the
// environment the console works in.
//
// Shared by the bundle (`manifest.ui.extras`) and the draft, so a project
// reopened from either comes back the same way.

import { useGeometryEditStore, type NamedSession } from '@/store/geometryEdit'
import { useSpatialStore, type PendingGeometryEdit, type PendingEditMeta } from '@/store/spatial'
import { useSessionStore } from '@/store/session'
import { changeWorkingDir } from '@/lib/working-dir'
import { setWorkingEnv } from '@/lib/working-env'
import { GLOBAL_ENV } from '@/lib/environments'

export interface WorkingExtras {
  /** Named map sessions. A live drawing session inside one is not kept — it
   *  holds an undo stack and a half-drawn draft — but the session itself, its
   *  layers and its extent are. */
  mapSessions?: { sessions: NamedSession[]; activeSessionId: string | null }
  pendingEdits?: { edits: Record<string, PendingGeometryEdit[]>; meta: Record<string, PendingEditMeta> }
  workingDir?: string | null
  workingEnv?: string
}

export function buildExtras(): WorkingExtras {
  const geometry = useGeometryEditStore.getState()
  const spatial = useSpatialStore.getState()
  const session = useSessionStore.getState()
  return {
    mapSessions: {
      sessions: geometry.namedSessions.map(named => ({ ...named, session: null })),
      activeSessionId: geometry.activeSessionId,
    },
    pendingEdits: { edits: spatial.pendingGeometryEdits, meta: spatial.pendingEditMeta },
    workingDir: session.workingDir,
    workingEnv: session.workingEnv,
  }
}

/** Put the extras back. Map state is applied at once; the working directory
 *  and environment go through R — and so echo their R, as every GUI
 *  operation does — and only when they differ from where R already is. */
export async function applyExtras(extras: WorkingExtras | undefined, options: { touchR: boolean } = { touchR: true }): Promise<void> {
  if (!extras || typeof extras !== 'object') return
  if (extras.mapSessions && Array.isArray(extras.mapSessions.sessions)) {
    const sessions = extras.mapSessions.sessions.filter(s => s && typeof s.id === 'string')
    useGeometryEditStore.setState({
      namedSessions: sessions.map(s => ({ ...s, session: null })),
      activeSessionId: sessions.some(s => s.id === extras.mapSessions!.activeSessionId) ? extras.mapSessions.activeSessionId : (sessions[0]?.id ?? null),
    })
  }
  if (extras.pendingEdits && typeof extras.pendingEdits.edits === 'object') {
    useSpatialStore.setState({ pendingGeometryEdits: extras.pendingEdits.edits ?? {}, pendingEditMeta: extras.pendingEdits.meta ?? {} })
  }
  if (!options.touchR) return
  const session = useSessionStore.getState()
  if (typeof extras.workingDir === 'string' && extras.workingDir && extras.workingDir !== session.workingDir) {
    // A directory from another machine, or one deleted since, is reported by
    // changeWorkingDir in the console; R stays where it was.
    await changeWorkingDir(extras.workingDir)
  }
  if (typeof extras.workingEnv === 'string' && extras.workingEnv !== GLOBAL_ENV && extras.workingEnv !== useSessionStore.getState().workingEnv) {
    setWorkingEnv(extras.workingEnv)
  }
}

/** The state a fresh workspace starts from — what `clearWorkspaceStores`
 *  resets alongside the panels it already cleared. */
export function clearExtras(): void {
  useGeometryEditStore.setState({ namedSessions: [], activeSessionId: null })
  useSpatialStore.setState({ pendingGeometryEdits: {}, pendingEditMeta: {} })
}
