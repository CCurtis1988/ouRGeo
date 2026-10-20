// The warning after a session that did not close properly
// (docs/project-persistence-spec.md §3.3). Never silenced by any setting:
// the user has to learn that the last few seconds of work, or the R objects
// made after the last checkpoint, may be missing — and what to do about it.

import React from 'react'
import { ask } from '@/store/ask'
import { useLayoutStore } from '@/store/layout'

export interface CrashFacts {
  scratch: boolean
  /** Documents that came back with unsaved edits (or, in scratch, the notes). */
  documents: string[]
  /** Documents whose recovery copies could not be read. */
  lost: string[]
  checkpointAt: string | null
  newestChange: string | null
}

const time = (iso: string | null): string | null => iso ? new Date(iso).toLocaleString() : null

export async function reportCrash(facts: CrashFacts): Promise<void> {
  const checkpoint = time(facts.checkpointAt), newest = time(facts.newestChange)
  const answer = await ask({
    title: 'ouRGeo did not close properly',
    wide: true,
    body: <div className="space-y-2">
      <p>The last session ended without closing — a crash, a forced quit, or the computer shutting down. ouRGeo recovered what it had kept.</p>
      <p><span className="text-foreground font-medium">Documents restored:</span> {facts.documents.length ? facts.documents.join(', ') : 'none had unsaved edits'}.</p>
      {facts.lost.length > 0 && <p className="text-geo-error">Could not be recovered (their recovery copies were unreadable): {facts.lost.join(', ')}.</p>}
      {facts.scratch
        ? <p>This was scratch, which keeps only its untitled documents: its R objects, map and plots were not kept, as they would not have been on a normal close.</p>
        : checkpoint
          ? <p><span className="text-foreground font-medium">R objects</span> were restored from the checkpoint at {checkpoint}. Objects created after this need re-running; the console history shows what you ran.</p>
          : <p><span className="text-foreground font-medium">R objects</span> were restored from the saved project: no checkpoint had been taken since it was opened. Objects created since then need re-running; the console history shows what you ran.</p>}
      {newest && <p>The newest recovered change is from {newest}.</p>}
    </div>,
    choices: [{ id: 'dismiss', label: 'Dismiss' }, { id: 'console', label: 'Show console history', variant: 'primary' }],
    cancelId: 'dismiss',
  })
  if (answer.choice === 'console') useLayoutStore.getState().setActivePanel('console')
}
