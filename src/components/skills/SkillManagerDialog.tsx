import React, { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Upload, FolderOpen, Plus, Download, Copy, Archive, ArchiveRestore, Trash2, Lock, History } from 'lucide-react'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { Switch } from '../ui/switch'
import { useSkillStore, reparseSkill } from '@/store/skills'
import { useProjectStore } from '@/store/project'
import { ask } from '@/store/ask'
import { useUiStore } from '@/store/ui'
import { skillText } from '@/lib/skills/library'
import { FILTER_LABELS, NEW_SKILL_TEXT, duplicateShipped, importSkill, listSkills, skillBodyOf, testSkill, tokenCost, type SkillFilter } from '@/lib/skills/manager'
import type { SkillEntry } from '@/lib/skills/catalog'
import type { SkillMode } from '@/lib/skills/types'
import { cn } from '@/lib/utils'

// Where the user decides what the assistant follows (lib/skills, design note
// ai-skills.md). A sibling of Settings, like the Theme Studio and the Plugin
// Manager, for the same focus-trap reason.
//
// The switches here are the user's alone: the assistant can write skills, but it
// cannot switch one on, change when it is used, lock it, or delete it. Anything it
// wrote shows "Written by the assistant" until the user edits it.

const MODE_LABELS: Record<SkillMode, string> = { auto: 'Automatically, when it fits', always: 'Always in context', manual: 'Only when I ask for it' }
const SOURCE_LABELS = { builtin: 'Built-in', plugin: 'Plugin', user: 'Mine', project: 'This project' } as const

export function SkillManagerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.ReactElement {
  const revision = useSkillStore(s => s.revision)
  const projectSaved = useProjectStore(s => Boolean(s.path))
  const [filter, setFilter] = useState<SkillFilter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [notice, setNotice] = useState('')
  // `revision` is what changes when the library does; the list is rebuilt from the live catalog.
  const skills = useMemo(() => listSkills(filter, query), [filter, query, revision]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = useMemo(() => [...listSkills('all', ''), ...listSkills('archived', '')].find(s => s.sourceId === selected) ?? null, [selected, revision]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!projectSaved) setScope('global') }, [projectSaved])
  // Opened from "Review" on something the assistant saved: select that skill.
  const dialogArg = useUiStore(s => s.dialogArg)
  useEffect(() => { if (open && dialogArg?.startsWith('skill:')) { setSelected(dialogArg); setFilter('all'); setQuery('') } }, [open, dialogArg])

  const toggle = (entry: SkillEntry, enabled: boolean): void => {
    const result = entry.stored
      ? useSkillStore.getState().setControls(entry.stored.id, { enabled }, 'user')
      : useSkillStore.getState().setShipped(entry.sourceId, { enabled }, 'user')
    if (!result.ok) setNotice(result.error)
  }

  const runImport = async (kind: 'file' | 'folder'): Promise<void> => {
    try {
      const read = await window.electronAPI.dialog.openSkill(kind)
      if (!read) return
      const { change, skipped } = importSkill(read, scope)
      if (!change.ok) { setNotice(change.error); return }
      setSelected(`skill:${change.skill.id}`)
      setNotice([`Imported "${change.skill.definition.name}". It is switched off: read it, then switch it on.`, ...change.warnings, ...(skipped.length ? [`Left out: ${skipped.join(', ')}.`] : [])].join(' '))
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    }
  }

  const create = (): void => {
    const parsed = reparseSkill(NEW_SKILL_TEXT.replace('my-new-skill', freeNewName()))
    if (typeof parsed === 'string') { setNotice(parsed); return }
    const change = useSkillStore.getState().create(parsed, 'user', scope)
    if (!change.ok) { setNotice(change.error); return }
    setSelected(`skill:${change.skill.id}`)
    setNotice('New skill created. Give it a name, a "Use when …" description and steps, then save.')
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[960px] max-w-[95vw] h-[80vh] flex flex-col bg-geo-panel border border-geo-border rounded-lg shadow-xl focus:outline-none">
          <div className="flex items-start justify-between px-5 py-4 border-b border-geo-border shrink-0">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold text-foreground">Skills</Dialog.Title>
              <Dialog.Description className="text-[11px] text-geo-muted mt-1 leading-snug">
                Instructions the assistant follows for a kind of task. It loads one when your request fits, or when you
                name it ("use your short-report skill", or <code className="text-foreground">/short-report</code>).
                A skill is guidance: it cannot change what the assistant is allowed to do.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-geo-muted hover:text-foreground shrink-0"><X className="w-3.5 h-3.5" /></Button>
            </Dialog.Close>
          </div>

          <div className="flex items-center gap-2 px-5 py-2 border-b border-geo-border shrink-0">
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1.5" onClick={create} data-ourgeo-id="skills.new"><Plus className="w-3 h-3" /> New skill</Button>
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1.5" onClick={() => void runImport('file')} data-ourgeo-id="skills.import"><Upload className="w-3 h-3" /> Import file…</Button>
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1.5" onClick={() => void runImport('folder')}><FolderOpen className="w-3 h-3" /> Import folder…</Button>
            {projectSaved && (
              <label className="flex items-center gap-1.5 text-[11px] text-geo-muted">
                Save new skills to
                <select value={scope} onChange={e => setScope(e.target.value as 'global' | 'project')} className="bg-geo-bg border border-geo-border rounded px-1 py-0.5 text-foreground">
                  <option value="global">this computer</option>
                  <option value="project">this project</option>
                </select>
              </label>
            )}
            <div className="flex-1" />
            <input aria-label="Search skills" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search skills" className="h-6 w-48 bg-geo-bg border border-geo-border rounded px-2 text-xs text-foreground placeholder:text-geo-muted focus:outline-none focus:border-geo-accent" />
          </div>
          {notice && <p className="px-5 py-1.5 text-[11px] text-geo-muted border-b border-geo-border">{notice}</p>}

          <div className="flex flex-1 min-h-0">
            <div className="w-[380px] shrink-0 border-r border-geo-border flex flex-col min-h-0">
              <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-geo-border">
                {(Object.keys(FILTER_LABELS) as SkillFilter[]).map(f => (
                  <button key={f} onClick={() => setFilter(f)} className={cn('px-2 py-0.5 rounded text-[10px] border', filter === f ? 'border-geo-accent text-foreground' : 'border-geo-border text-geo-muted hover:text-foreground')}>{FILTER_LABELS[f]}</button>
                ))}
              </div>
              <ScrollArea className="flex-1">
                <ul className="p-2 space-y-1">
                  {skills.map(entry => (
                    <li key={entry.sourceId} className={cn('rounded-md border', selected === entry.sourceId ? 'border-geo-accent' : 'border-transparent')}>
                      <Switch checked={entry.enabled} onChange={on => toggle(entry, on)} disabled={entry.stored?.archived}
                        label={<span className="flex items-center gap-1.5">{entry.name}<Badges entry={entry} /></span>}
                        description={entry.description} />
                      <button onClick={() => setSelected(entry.sourceId)} className="ml-3 mb-1 text-[10px] text-geo-accent hover:underline">
                        {MODE_LABELS[entry.mode]} · Details
                      </button>
                    </li>
                  ))}
                  {!skills.length && <li className="text-xs text-geo-muted px-2 py-4">No skills match.</li>}
                </ul>
              </ScrollArea>
            </div>
            <div className="flex-1 min-w-0">
              {current ? <SkillDetail key={current.sourceId} entry={current} onNotice={setNotice} onSelect={setSelected} /> : (
                <p className="text-xs text-geo-muted p-6">Choose a skill to see what it says, when the assistant uses it, and what has changed.</p>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function freeNewName(): string {
  const taken = new Set(listSkills('all', '').map(s => s.name))
  let name = 'my-new-skill', n = 2
  while (taken.has(name)) name = `my-new-skill-${n++}`
  return name
}

function Badges({ entry }: { entry: SkillEntry }): React.ReactElement {
  return (
    <span className="flex items-center gap-1">
      <span className="text-[9px] px-1 rounded border border-geo-border text-geo-muted">{SOURCE_LABELS[entry.source]}</span>
      {entry.stored?.createdBy === 'import' && entry.stored.updatedBy === 'import' && <span className="text-[9px] px-1 rounded border border-geo-border text-geo-muted" title="From a file someone else wrote. Read it before switching it on.">Imported</span>}
      {entry.stored?.updatedBy === 'agent' && <span className="text-[9px] px-1 rounded border border-geo-accent text-geo-accent" title="Written or last changed by the assistant. Review it, then edit or lock it.">Written by the assistant</span>}
      {entry.stored?.locked && <Lock className="w-2.5 h-2.5 text-geo-muted" />}
    </span>
  )
}

function SkillDetail({ entry, onNotice, onSelect }: { entry: SkillEntry; onNotice: (text: string) => void; onSelect: (id: string | null) => void }): React.ReactElement {
  const stored = entry.stored
  const original = stored ? skillText(stored.definition) : skillBodyOf(entry)
  const [text, setText] = useState(original)
  const [probe, setProbe] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  useEffect(() => setText(original), [original])
  const dirty = text !== original

  const setMode = (mode: SkillMode): void => {
    const result = stored ? useSkillStore.getState().setControls(stored.id, { mode }, 'user') : useSkillStore.getState().setShipped(entry.sourceId, { mode }, 'user')
    if (!result.ok) onNotice(result.error)
  }
  const save = (): void => {
    if (!stored) return
    const parsed = reparseSkill(text)
    if (typeof parsed === 'string') { onNotice(parsed); return }
    const change = useSkillStore.getState().update(stored.id, { ...parsed, resources: stored.definition.resources }, 'user')
    if (!change.ok) { onNotice(change.error); return }
    onSelect(`skill:${change.skill.id}`)
    onNotice(`Saved "${change.skill.definition.name}".`)
  }
  const duplicate = (): void => {
    const change = useSkillStore.getState().create(duplicateShipped(entry), 'user')
    if (!change.ok) { onNotice(change.error); return }
    onSelect(`skill:${change.skill.id}`)
    onNotice(`Copied "${entry.name}" to "${change.skill.definition.name}", which you can edit.`)
  }
  const exportSkill = async (): Promise<void> => {
    const folder = await window.electronAPI.dialog.exportSkill(entry.name, stored ? skillText(stored.definition) : `---\nname: ${entry.name}\ndescription: ${JSON.stringify(entry.description)}\n---\n\n${skillBodyOf(entry)}\n`, stored?.definition.resources ?? {})
    if (folder) onNotice(`Exported to ${folder}.`)
  }
  const remove = async (): Promise<void> => {
    if (!stored) return
    const answer = await ask({ title: `Delete "${entry.name}"?`, body: 'The skill and its history are removed from this computer. Archive it instead to keep it out of the way and restorable.', choices: [{ id: 'cancel', label: 'Cancel' }, { id: 'delete', label: 'Delete', variant: 'danger' }], cancelId: 'cancel' })
    if (answer.choice !== 'delete') return
    const result = useSkillStore.getState().remove(stored.id, 'user')
    if (!result.ok) { onNotice(result.error); return }
    onSelect(null)
    onNotice(`Deleted "${entry.name}".`)
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">{entry.name}<Badges entry={entry} /></h3>
          <p className="text-[11px] text-geo-muted mt-1">{entry.description}</p>
          <p className="text-[10px] text-geo-muted mt-1">About {tokenCost(entry).toLocaleString()} tokens when loaded{stored ? ` · used ${stored.usage.loads} time${stored.usage.loads === 1 ? '' : 's'}${stored.usage.lastUsed ? `, last ${new Date(stored.usage.lastUsed).toLocaleString()}` : ''}` : ''}</p>
        </div>

        <label className="block text-[11px] text-geo-muted">
          When the assistant uses it
          <select value={entry.mode} onChange={e => setMode(e.target.value as SkillMode)} className="mt-1 block w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground">
            {(Object.keys(MODE_LABELS) as SkillMode[]).map(mode => <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>)}
          </select>
        </label>
        {entry.mode === 'always' && <p className="text-[10px] text-geo-muted -mt-2">Sent with every message, about {tokenCost(entry).toLocaleString()} tokens each time. Use it for a skill the assistant keeps missing.</p>}

        {stored && (
          <Switch checked={stored.locked} onChange={locked => { const r = useSkillStore.getState().setControls(stored.id, { locked }, 'user'); if (!r.ok) onNotice(r.error) }}
            label="Locked" description="The assistant cannot change a locked skill. It can still use it." />
        )}

        <div>
          <p className="text-[11px] text-geo-muted mb-1">{stored ? 'SKILL.md' : 'What it says (built in, read-only)'}</p>
          <textarea aria-label={stored ? 'SKILL.md text' : 'Skill text (read-only)'} value={text} onChange={e => setText(e.target.value)} readOnly={!stored} spellCheck={false}
            className="w-full h-72 bg-geo-bg border border-geo-border rounded p-2 font-mono text-[11px] text-foreground focus:outline-none focus:border-geo-accent" />
          <div className="flex flex-wrap gap-2 mt-2">
            {stored && <Button size="sm" className="h-6 text-xs" disabled={!dirty} onClick={save}>Save</Button>}
            {stored && dirty && <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setText(original)}>Discard changes</Button>}
            {!stored && <Button variant="ghost" size="sm" className="h-6 text-xs gap-1.5" onClick={duplicate}><Copy className="w-3 h-3" /> Duplicate to edit</Button>}
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1.5" onClick={() => void exportSkill()}><Download className="w-3 h-3" /> Export…</Button>
            {stored && !stored.archived && <Button variant="ghost" size="sm" className="h-6 text-xs gap-1.5" onClick={() => { const r = useSkillStore.getState().archive(stored.id, 'user'); onNotice(r.ok ? `Archived "${entry.name}".` : r.error) }}><Archive className="w-3 h-3" /> Archive</Button>}
            {stored?.archived && <Button variant="ghost" size="sm" className="h-6 text-xs gap-1.5" onClick={() => { const r = useSkillStore.getState().restore(stored.id, 'user'); onNotice(r.ok ? `Restored "${entry.name}".` : r.error) }}><ArchiveRestore className="w-3 h-3" /> Restore</Button>}
            {stored && <Button variant="ghost" size="sm" className="h-6 text-xs gap-1.5 text-geo-error" onClick={() => void remove()}><Trash2 className="w-3 h-3" /> Delete</Button>}
          </div>
          {stored && Object.keys(stored.definition.resources).length > 0 && <p className="text-[10px] text-geo-muted mt-2">Supporting files: {Object.keys(stored.definition.resources).join(', ')}</p>}
        </div>

        {stored && stored.history.length > 0 && (
          <div>
            <button onClick={() => setShowHistory(v => !v)} className="flex items-center gap-1.5 text-[11px] text-geo-accent hover:underline"><History className="w-3 h-3" /> {stored.history.length} earlier version{stored.history.length === 1 ? '' : 's'}</button>
            {showHistory && (
              <ul className="mt-2 space-y-2">
                {stored.history.map((revision, index) => (
                  <li key={`${revision.at}-${index}`} className="border border-geo-border rounded p-2">
                    <div className="flex items-center justify-between text-[10px] text-geo-muted">
                      <span>{new Date(revision.at).toLocaleString()} · replaced text written by {revision.by === 'agent' ? 'the assistant' : revision.by === 'import' ? 'an import' : 'you'}{revision.note ? ` · ${revision.note}` : ''}</span>
                      <Button variant="ghost" size="sm" className="h-5 text-[10px]" onClick={() => { const r = useSkillStore.getState().revert(stored.id, index, 'user'); onNotice(r.ok ? 'Restored that version. The text it replaced is in the history too.' : r.error) }}>Restore this version</Button>
                    </div>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-geo-muted">{revision.text}</pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div>
          <p className="text-[11px] text-geo-muted mb-1">Test this skill: would a message bring it in?</p>
          <input aria-label="Test message" value={probe} onChange={e => setProbe(e.target.value)} placeholder="Type a message you might send" className="w-full h-7 bg-geo-bg border border-geo-border rounded px-2 text-xs text-foreground placeholder:text-geo-muted focus:outline-none focus:border-geo-accent" />
          <ul className="mt-1 space-y-0.5">{testSkill(entry, probe).map(reason => <li key={reason} className="text-[11px] text-foreground">{reason}</li>)}</ul>
        </div>
      </div>
    </ScrollArea>
  )
}
