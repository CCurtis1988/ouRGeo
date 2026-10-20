// Leaving a workspace — quitting, or switching to another project
// (docs/project-persistence-spec.md §1.3, §2.2–§2.4). Every way out goes
// through `leaveCurrentWorkspace`: the window's close button, the project
// menu, and the assistant's project actions.
//
// A NAMED project, by default, never asks: its working state is already in
// its draft, and the R environment is checkpointed on the way out. Settings →
// Projects can make it save automatically, or ask.
//
// SCRATCH keeps only its untitled notes. Before anything else is dropped the
// user is offered Save as project (prompt 1), and then asked about each
// script with edits not yet written to its file (prompt 2).

import React from 'react'
import { ask } from '@/store/ask'
import { useProjectStore } from '@/store/project'
import { useEditorStore, type TabState } from '@/store/editor'
import { useEnvironmentStore } from '@/store/environment'
import { useSpatialStore } from '@/store/spatial'
import { usePlottingStore } from '@/store/plotting'
import { useAiStore } from '@/store/ai'
import { useProjectSettingsStore, loadProjectSettings } from '@/store/project-settings'
import { usePromptPreferences, loadPromptPreferences } from '@/store/prompt-preferences'
import { addRecentlyClosed } from '@/store/recently-closed'
import { saveCurrentProject, saveProjectAs, loadProjectFromPath, newProject } from '@/lib/project-persistence'
import { flushDraft, checkpointNow, envChangedSinceCheckpoint } from '@/lib/project-draft'
import { hasUnsavedEdits, saveDocument } from '@/lib/document-close'
import { diffStats } from '@/lib/text-diff'

export type LeaveReason = 'quit' | 'switch'

/** Everything the draft holds, written now; R checkpointed if it changed. */
export async function keepOnThisComputer(): Promise<void> {
  await flushDraft()
  if (useProjectStore.getState().path !== null && envChangedSinceCheckpoint()) await checkpointNow({ sync: true })
  await flushDraft()
}

// ── Named projects ────────────────────────────────────────────────────────────
async function leaveNamed(reason: LeaveReason): Promise<boolean> {
  await loadProjectSettings()
  const { isDirty, name } = useProjectStore.getState()
  if (!isDirty) { await keepOnThisComputer(); return true }
  const behaviour = useProjectSettingsStore.getState().closeBehavior
  if (behaviour === 'save') return saveCurrentProject()
  if (behaviour === 'ask') {
    const answer = await ask({
      title: 'Unsaved changes',
      body: <p><span className="text-foreground font-medium">{name}</span> has changes that are not in its project file. Save them before {reason === 'quit' ? 'closing' : 'switching'}? Don&apos;t Save keeps them on this computer, and they are there when you open the project again.</p>,
      choices: [{ id: 'cancel', label: 'Cancel' }, { id: 'keep', label: "Don't Save", variant: 'default' }, { id: 'save', label: 'Save', variant: 'primary' }],
      cancelId: 'cancel',
    })
    if (answer.choice === 'cancel') return false
    if (answer.choice === 'save') return saveCurrentProject()
  }
  await keepOnThisComputer()
  return true
}

// ── Scratch ───────────────────────────────────────────────────────────────────
export interface ScratchLosses { objects: number; layers: number; plots: number; files: number; chats: number }

/** What leaving scratch would drop. Untitled documents survive and are not
 *  counted; ouRGeo's own objects in .GlobalEnv are not the user's. */
export function scratchLosses(): ScratchLosses {
  const env = useEnvironmentStore.getState()
  const hidden = new Set([...env.systemNames, ...(env.rdataLoadedNames['.GlobalEnv'] ?? [])])
  const objects = env.environments.filter(e => !e.isSearchPath).reduce((sum, e) => sum + e.objects.filter(o => !hidden.has(o.name)).length, 0)
  return {
    objects,
    layers: useSpatialStore.getState().layers.length,
    plots: usePlottingStore.getState().plots.length,
    files: useEditorStore.getState().tabs.filter(t => (!t.type || t.type === 'code') && t.filePath).length,
    chats: useAiStore.getState().chats.filter(chat => chat.messages.length > 0).length,
  }
}

export function describeLosses(losses: ScratchLosses): string[] {
  const n = (count: number, one: string, many: string): string | null => count ? `${count} ${count === 1 ? one : many}` : null
  return [
    n(losses.objects, 'R object', 'R objects'), n(losses.layers, 'map layer', 'map layers'), n(losses.plots, 'plot', 'plots'),
    n(losses.files, 'open file', 'open files'), n(losses.chats, 'assistant chat', 'assistant chats'),
  ].filter((part): part is string => part !== null)
}

/** Prompt 2: each file-backed document with edits not in its file. */
async function applyOrDropEdits(): Promise<boolean> {
  const dirty = useEditorStore.getState().tabs.filter(t => (!t.type || t.type === 'code') && t.filePath && hasUnsavedEdits(t))
  let blanket: 'apply' | 'drop' | null = null
  for (let i = 0; i < dirty.length; i++) {
    const tab = useEditorStore.getState().tabs.find(t => t.id === dirty[i].id)
    if (!tab) continue
    let decision: 'apply' | 'drop' | null = blanket
    if (!decision) {
      const disk = await window.electronAPI.file.read(tab.filePath!).catch(() => '')
      const stats = diffStats(disk, tab.content)
      const answer = await ask({
        title: `Apply your edits to ${tab.fileName}?`,
        body: <p>
          <span className="font-mono text-foreground">{tab.filePath}</span> has unsaved edits
          ({stats.added} line{stats.added === 1 ? '' : 's'} added, {stats.removed} removed).
          Scratch keeps only untitled documents, so these edits are written to the file or dropped now.
        </p>,
        choices: [{ id: 'cancel', label: 'Cancel' }, { id: 'drop', label: 'Drop', variant: 'default' }, { id: 'apply', label: 'Apply', variant: 'primary' }],
        cancelId: 'cancel',
        checkbox: dirty.length - i > 1 ? { label: `Apply to all remaining (${dirty.length - i - 1} more)` } : undefined,
      })
      if (answer.choice === 'cancel') return false
      decision = answer.choice as 'apply' | 'drop'
      if (answer.checked) blanket = decision
    }
    if (decision === 'drop') continue
    if (!await writeOrRecover(tab)) return false
  }
  return true
}

/** A write that fails stops and says what to do; it never drops silently. */
async function writeOrRecover(tab: TabState): Promise<boolean> {
  for (;;) {
    try { await saveDocument(tab); return true }
    catch (error) {
      const answer = await ask({
        title: `Could not write ${tab.fileName}`,
        body: <p><span className="font-mono text-foreground">{tab.filePath}</span> could not be written ({String(error).replace(/^Error: /, '')}). Save the edits to a new file with Save As…, or drop them.</p>,
        choices: [{ id: 'cancel', label: 'Cancel' }, { id: 'drop', label: 'Drop', variant: 'default' }, { id: 'saveas', label: 'Save As…', variant: 'primary' }],
        cancelId: 'cancel',
      })
      if (answer.choice === 'cancel') return false
      if (answer.choice === 'drop') return true
      try { if (await saveDocument(tab, true)) return true } catch { /* ask again */ }
    }
  }
}

async function leaveScratch(): Promise<boolean> {
  await loadPromptPreferences()
  const losses = scratchLosses()
  const parts = describeLosses(losses)
  if (parts.length && usePromptPreferences.getState().askScratchSave) {
    const answer = await ask({
      title: 'Save scratch as a project?',
      body: <>
        <p>Leaving scratch drops {parts.join(', ')}. Only untitled documents are kept.</p>
        <p>Save as project keeps all of it — including edits to open files, still unsaved, inside the project.</p>
      </>,
      choices: [{ id: 'cancel', label: 'Cancel' }, { id: 'drop', label: "Don't save", variant: 'default' }, { id: 'save', label: 'Save as project…', variant: 'primary' }],
      cancelId: 'cancel',
      checkbox: { label: "Don't ask again", hint: "From then on, leaving scratch behaves as Don't save. Turn this back on in Settings → Prompts." },
    })
    if (answer.choice === 'cancel') return false
    if (answer.checked) usePromptPreferences.getState().set('askScratchSave', false)
    if (answer.choice === 'save') {
      // The picker cancelled is the whole leave cancelled. Saved, the work is
      // a named project now, and prompt 2 has nothing to ask (§2.3).
      if (!await saveProjectAs()) return false
      await keepOnThisComputer()
      return true
    }
  }
  if (!await applyOrDropEdits()) return false
  // Past the last question: drop the file-backed documents, remembering them
  // in Recently closed, and write scratch's untitled notes.
  const files = useEditorStore.getState().tabs.filter(t => (!t.type || t.type === 'code') && t.filePath)
  addRecentlyClosed(files.map(t => t.filePath!))
  for (const tab of files) useEditorStore.getState().closeTab(tab.id)
  await flushDraft()
  return true
}

/** Leave the current project or scratch. False means the user cancelled, and
 *  nothing has changed. */
export async function leaveCurrentWorkspace(reason: LeaveReason): Promise<boolean> {
  return useProjectStore.getState().path === null ? leaveScratch() : leaveNamed(reason)
}

export type SwitchTarget = { kind: 'open'; path: string } | { kind: 'pick' } | { kind: 'scratch' }

/** Leave, then open the target. Choosing the file comes first, so cancelling
 *  the picker leaves the workspace untouched. */
export async function switchProject(target: SwitchTarget): Promise<boolean> {
  let path: string | null = null
  if (target.kind === 'pick') { path = await window.electronAPI.dialog.openProject(); if (!path) return false }
  else if (target.kind === 'open') path = target.path
  if (path && path === useProjectStore.getState().path) return true
  if (!await leaveCurrentWorkspace('switch')) return false
  if (!path) { await newProject(); return true }
  return loadProjectFromPath(path)
}
