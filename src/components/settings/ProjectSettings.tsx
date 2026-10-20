import React, { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Switch } from '../ui/switch'
import { Button } from '../ui/button'
import {
  CHECKPOINT_CHOICES, loadProjectSettings, useProjectSettingsStore, type CloseBehavior,
} from '@/store/project-settings'
import { useDraftStatus } from '@/lib/project-draft'
import { useProjectStore } from '@/store/project'
import { ask } from '@/store/ask'
import { fileSize } from '@/lib/project-files-ui'
import type { DraftListing } from '@/lib/project-draft-types'

const CLOSE_CHOICES: { value: CloseBehavior; label: string; description: string }[] = [
  { value: 'keep', label: 'Keep unsaved changes on this computer', description: 'Closing or switching never asks. Your work is there when you open the project again, here; the project file is unchanged until you save.' },
  { value: 'save', label: 'Save the project automatically', description: 'Closing or switching saves the project file, so colleagues opening it see your work.' },
  { value: 'ask', label: 'Ask', description: 'Save, or Don\'t Save — which still keeps your changes on this computer.' },
]

/** Settings → Projects (docs/project-persistence-spec.md §4.2). */
export function ProjectSettings(): React.ReactElement {
  const closeBehavior = useProjectSettingsStore(s => s.closeBehavior)
  const interval = useProjectSettingsStore(s => s.checkpointInterval)
  const saveDocs = useProjectSettingsStore(s => s.saveDocumentsWithProject)
  const { setCloseBehavior, setCheckpointInterval, setSaveDocumentsWithProject } = useProjectSettingsStore.getState()
  const checkpointAt = useDraftStatus(s => s.checkpointAt)
  const checkpointMs = useDraftStatus(s => s.checkpointMs)
  const named = useProjectStore(s => s.path !== null)
  useEffect(() => { void loadProjectSettings() }, [])

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="space-y-2">
        <legend className="text-xs text-foreground mb-1">When closing a saved project</legend>
        {CLOSE_CHOICES.map(choice => (
          <label key={choice.value} className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="close-behavior" className="mt-0.5" checked={closeBehavior === choice.value} onChange={() => setCloseBehavior(choice.value)} />
            <span className="flex flex-col"><span className="text-xs text-foreground">{choice.label}</span><span className="text-[10px] text-geo-muted leading-relaxed">{choice.description}</span></span>
          </label>
        ))}
      </fieldset>

      <div className="space-y-1">
        <label className="flex items-center gap-2 text-xs text-foreground">
          R snapshot interval
          <select data-ourgeo-id="settings.projectsCheckpointInterval" value={interval} onChange={e => setCheckpointInterval(Number(e.target.value))}
            className="rounded border border-geo-border bg-geo-bg px-2 py-1 text-xs text-foreground">
            {CHECKPOINT_CHOICES.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select>
        </label>
        <p className="text-[10px] text-geo-muted leading-relaxed">
          After R has been idle this long, and its objects have changed, they are snapshotted so a crash costs only what came
          after. Snapshots run in the background and never hold up a command. A large environment takes longer to snapshot,
          so a longer interval suits it; a shorter one loses less in a crash.
          {named && (checkpointMs !== null
            ? ` The last snapshot of this project took ${(checkpointMs / 1000).toFixed(1)} s${checkpointAt ? `, at ${new Date(checkpointAt).toLocaleTimeString()}` : ''}.`
            : ' This project has not been snapshotted since it was opened.')}
        </p>
      </div>

      <Switch checked={saveDocs} onChange={setSaveDocumentsWithProject} data-ourgeo-id="settings.projectsSaveDocuments"
        label="Save document edits when saving the project"
        description="Off: a project save keeps edits to open files as unsaved edits inside the project, and the files on disk are untouched until you save each one. On: every project save — including an automatic one on closing or switching — writes them to their files first. Untitled documents stay in the project either way." />

      <StoredDrafts />
    </div>
  )
}

/** Drafts held on this computer, and the way to clear them out. They are kept
 *  until deleted here: a draft is someone's unsaved work. */
export function StoredDrafts(): React.ReactElement {
  const [drafts, setDrafts] = useState<DraftListing[] | null>(null)
  const [age, setAge] = useState(90)
  const refresh = useCallback(() => { void window.electronAPI.drafts.list().then(setDrafts, () => setDrafts([])) }, [])
  useEffect(() => { refresh() }, [refresh])
  const total = drafts?.reduce((sum, d) => sum + d.bytes, 0) ?? 0

  const remove = async (draft: DraftListing): Promise<void> => {
    const answer = await ask({
      title: `Delete the draft of ${draft.name}?`,
      body: `${draft.changed ? 'Its unsaved changes are deleted permanently.' : 'It holds no unsaved changes — only where you were in each document.'} ${draft.path} itself is not touched.`,
      choices: [{ id: 'cancel', label: 'Cancel' }, { id: 'delete', label: 'Delete draft', variant: 'danger' }], cancelId: 'cancel',
    })
    if (answer.choice !== 'delete') return
    await window.electronAPI.drafts.delete([draft.key])
    refresh()
  }
  const removeOld = async (): Promise<void> => {
    const old = (drafts ?? []).filter(d => !d.open && (!d.updatedAt || Date.now() - Date.parse(d.updatedAt) > age * 86_400_000))
    if (!old.length) { await ask({ title: 'Nothing to delete', body: `No draft is older than ${age} days.`, choices: [{ id: 'ok', label: 'OK', variant: 'primary' }], cancelId: 'ok' }); return }
    const answer = await ask({
      title: `Delete ${old.length} draft${old.length === 1 ? '' : 's'} older than ${age} days?`,
      body: `${old.map(d => d.name).join(', ')}. Unsaved changes in them are deleted permanently; the project files themselves are not touched.`,
      choices: [{ id: 'cancel', label: 'Cancel' }, { id: 'delete', label: 'Delete', variant: 'danger' }], cancelId: 'cancel',
    })
    if (answer.choice !== 'delete') return
    await window.electronAPI.drafts.deleteOlderThan(age)
    refresh()
  }

  return (
    <div className="space-y-2" data-ourgeo-id="settings.projectsDrafts">
      <p className="text-xs text-foreground">Stored unsaved changes</p>
      <p className="text-[10px] text-geo-muted leading-relaxed">
        Drafts held on this computer for saved projects{drafts ? ` — ${drafts.length}, ${fileSize(total)} in all` : ''}. Each
        includes a copy of the project as it was opened, used to resolve conflicts if the file changes elsewhere.
      </p>
      {drafts === null ? <p className="text-[11px] text-geo-muted">Reading…</p> : drafts.length === 0 ? <p className="text-[11px] text-geo-muted">None.</p> : (
        <ul className="divide-y divide-geo-border rounded border border-geo-border">
          {drafts.map(draft => (
            <li key={draft.key} className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
              <span className="flex-1 min-w-0">
                <span className="block text-foreground truncate">{draft.name}{draft.changed ? '' : ' · no unsaved changes'}{draft.open ? ' · open' : ''}</span>
                <span className="block text-geo-muted truncate" title={draft.path}>{draft.fileExists ? draft.path : `${draft.path} — project file not found`}</span>
              </span>
              <span className="text-geo-muted shrink-0">{fileSize(draft.bytes)}</span>
              <span className="text-geo-muted shrink-0 w-28 text-right">{draft.updatedAt ? new Date(draft.updatedAt).toLocaleDateString() : '—'}</span>
              <button type="button" aria-label={`Delete the draft of ${draft.name}`} disabled={draft.open} title={draft.open ? 'Open in this window: close the project first' : 'Delete this draft'}
                onClick={() => void remove(draft)} className="p-1 text-geo-muted hover:text-geo-error disabled:opacity-40 disabled:cursor-not-allowed"><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-geo-muted flex items-center gap-1.5">Delete drafts older than
          <select value={age} onChange={e => setAge(Number(e.target.value))} className="rounded border border-geo-border bg-geo-bg px-1.5 py-0.5 text-[11px] text-foreground">
            {[30, 90, 365].map(days => <option key={days} value={days}>{days} days</option>)}
          </select>
        </label>
        <Button size="sm" variant="ghost" className="border border-geo-border h-6 text-[11px]" data-ourgeo-id="settings.projectsDeleteOld" onClick={() => void removeOld()}>Delete…</Button>
      </div>
    </div>
  )
}
