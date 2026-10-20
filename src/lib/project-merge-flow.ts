// Resolving conflicts between this computer's version of a project and a
// bundle someone else saved over it (docs/project-persistence-spec.md §1.9),
// and counting what Revert would discard (§1.6).
//
// The three sides:
//   base   — the bundle as this draft first opened it (kept in the draft)
//   mine   — the live workspace: this project opened WITH its draft
//   theirs — the bundle on disk now
// Mine is opened first so that every comparison reads the one source of
// truth for it — the stores, R and the file library — rather than a second
// reconstruction of the draft. Nothing is written to the bundle until Finish;
// Cancel leaves the user in their own version, and the next save or open asks
// again, because the file still differs from the base.

import { create } from 'zustand'
import { rClient, type MergeEnvItem } from '@/lib/r-client'
import { planDocs, planKeyed, planR, mergeList, mineName, resolvedSide, type MergeItem, type WholeChoice } from '@/lib/project-merge'
import { resolveMerge, type HunkChoice } from '@/lib/text-diff'
import { useProjectStore } from '@/store/project'
import { useEditorStore, type TabState } from '@/store/editor'
import { useSpatialStore, type SpatialLayer } from '@/store/spatial'
import { usePlottingStore, normalizePersistedPlots, type PlotEntry } from '@/store/plotting'
import { useAiStore, type AiChat } from '@/store/ai'
import { useEnvironmentStore } from '@/store/environment'
import { useSessionStore } from '@/store/session'
import { ask } from '@/store/ask'
import { hasUnsavedEdits } from '@/lib/document-close'
import { flushDraft } from '@/lib/project-draft'
import { loadProjectFromPath, saveOverExternalChange } from '@/lib/project-persistence'
import type { ProjectFileEntry } from '@/lib/project-files'

interface BundleUi {
  session?: { tabs?: TabState[] }
  workspace?: { layers?: SpatialLayer[] }
  plots?: { plots?: unknown; currentIndex?: number }
  chats?: { chats?: AiChat[] }
}
interface Inspected { ui: BundleUi; env: string | null; files: ProjectFileEntry[]; token: string }

async function inspect(path: string): Promise<Inspected> {
  const raw = await window.electronAPI.project.inspect(path)
  const manifest = JSON.parse(raw.projectJson) as { ui?: BundleUi }
  const catalogue = raw.catalogue as { files?: ProjectFileEntry[] } | null
  return { ui: manifest.ui ?? {}, env: raw.envRDataPath, files: Array.isArray(catalogue?.files) ? catalogue.files : [], token: raw.openToken }
}

const codeTabs = (tabs: TabState[] | undefined): TabState[] => (tabs ?? []).filter(t => !t.type || t.type === 'code')
const plotKey = (p: PlotEntry): string => p.plotId ?? `image:${p.dataUrl.length}:${p.dataUrl.slice(-48)}`
const fileFacts = (f: ProjectFileEntry | undefined): string => JSON.stringify(f ? [f.sha256, f.name, f.folder, f.role, f.userDescription, f.storage ?? null] : null)

function livePlots(): PlotEntry[] { return usePlottingStore.getState().plots }
/** Every workspace has one empty chat to type into; an empty chat is not a
 *  conversation to merge, on either side. */
const withMessages = (chats: AiChat[] | undefined): AiChat[] => (chats ?? []).filter(c => Array.isArray(c.messages) && c.messages.length > 0)

/** Every item that differs between the three versions. */
async function plan(base: Inspected, theirs: Inspected): Promise<{ items: MergeItem[]; rUnavailable: boolean }> {
  const items: MergeItem[] = []
  items.push(...planDocs(codeTabs(base.ui.session?.tabs), codeTabs(useEditorStore.getState().tabs), codeTabs(theirs.ui.session?.tabs)))
  let rUnavailable = false
  try {
    const res = await rClient.mergeEnvCompare({ base: base.env, mine: 'live', theirs: theirs.env })
    if (res.success === false) throw new Error(res.error)
    items.push(...planR(res.items ?? []))
  } catch { rUnavailable = true }
  items.push(...planKeyed<SpatialLayer>('layer', base.ui.workspace?.layers ?? [], useSpatialStore.getState().layers, theirs.ui.workspace?.layers ?? [], l => l.id, l => l.name))
  items.push(...planKeyed<PlotEntry>('plot', normalizePersistedPlots(base.ui.plots?.plots), livePlots(), normalizePersistedPlots(theirs.ui.plots?.plots), plotKey, () => 'Plot', (a, b) => (a?.dataUrl ?? null) === (b?.dataUrl ?? null)))
  items.push(...planKeyed<AiChat>('chat', withMessages(base.ui.chats?.chats), withMessages(useAiStore.getState().chats), withMessages(theirs.ui.chats?.chats), c => c.id, c => c.title || 'Chat', (a, b) => JSON.stringify(a?.messages ?? null) === JSON.stringify(b?.messages ?? null)))
  const lease = await window.electronAPI.context.lease()
  const mineFiles = (await window.electronAPI.projectFiles.catalogue(lease.id)).files
  items.push(...planKeyed<ProjectFileEntry>('file', base.files, mineFiles, theirs.files, f => f.id, f => f.folder ? `${f.folder}/${f.name}` : f.name, (a, b) => fileFacts(a) === fileFacts(b)))
  return { items, rUnavailable }
}

// ── The dialog's store ────────────────────────────────────────────────────────
/** `doc:<id>` → hunk choices; every other `kind:key` → a whole choice. */
export type MergeChoices = Record<string, WholeChoice | HunkChoice[]>
export interface MergeSession { path: string; items: MergeItem[]; rUnavailable: boolean; resolve: (choices: MergeChoices | null) => void }
export const useMergeStore = create<{ session: MergeSession | null }>(() => ({ session: null }))

function askUser(path: string, items: MergeItem[], rUnavailable: boolean): Promise<MergeChoices | null> {
  return new Promise(resolve => useMergeStore.setState({ session: { path, items, rUnavailable, resolve: choices => { useMergeStore.setState({ session: null }); resolve(choices) } } }))
}

// ── Applying ──────────────────────────────────────────────────────────────────
function wholeChoices(choices: MergeChoices): Record<string, WholeChoice> {
  return Object.fromEntries(Object.entries(choices).filter(([, v]) => typeof v === 'string')) as Record<string, WholeChoice>
}

function applyDocs(items: MergeItem[], choices: MergeChoices, theirTabs: TabState[]): void {
  const editor = useEditorStore.getState()
  const docItems = items.filter(i => i.kind === 'doc') as MergeItem<TabState>[]
  const textual = new Map(docItems.filter(i => i.segments).map(i => [i.key, i]))
  const whole = docItems.filter(i => !i.segments)
  const mine = editor.tabs.filter(t => !t.type || t.type === 'code')
  const objects = editor.tabs.filter(t => t.type && t.type !== 'code')
  const names = new Set(editor.tabs.map(t => t.fileName))
  const merged = mergeList<TabState>(mine, codeTabs(theirTabs), whole, wholeChoices(choices), t => t.id, (t) => {
    const fileName = mineName(t.fileName, n => names.has(n))
    names.add(fileName)
    return { ...t, id: crypto.randomUUID(), fileName, filePath: null, savedContent: '', isDirty: true }
  })
  const contentChanges: [string, string][] = []
  const tabs = merged.map(tab => {
    const item = textual.get(tab.id)
    if (!item?.segments) return tab
    const hunks = (choices[`doc:${tab.id}`] as HunkChoice[] | undefined) ?? []
    const content = resolveMerge(item.segments, hunks)
    contentChanges.push([tab.id, content])
    return { ...tab, content, isDirty: content !== tab.savedContent }
  })
  // A tab whose text came from theirs keeps its id, and Monaco caches a model
  // per id without re-reading the store, so its text goes in as an external
  // update — the channel the editor listens on.
  for (const tab of tabs) {
    const before = mine.find(t => t.id === tab.id)
    if (before && before.content !== tab.content && !contentChanges.some(([id]) => id === tab.id)) contentChanges.push([tab.id, tab.content])
  }
  editor.loadFromSession({ tabs: [...tabs, ...objects], activeTabId: editor.activeTabId, untitledCounter: editor.untitledCounter, activeByPanel: editor.activeByPanel })
  for (const [id, content] of contentChanges) useEditorStore.getState().applyExternalContent(id, content)
}

async function applyR(items: MergeItem[], choices: MergeChoices): Promise<void> {
  const rItems = items.filter(i => i.kind === 'r') as MergeItem<MergeEnvItem>[]
  const decided: Record<string, 'mine' | 'theirs' | 'both'> = {}
  for (const item of rItems) decided[item.key] = resolvedSide(item, choices[`r:${item.key}`] as WholeChoice) ?? 'mine'
  if (!Object.values(decided).some(side => side !== 'mine')) { await rClient.mergeEnvRelease().catch(() => undefined); return }
  const merged = await window.electronAPI.project.tempEnvPath()
  const built = await rClient.mergeEnvBuild(merged, decided)
  if (built.success === false) throw new Error(built.error ?? 'R could not build the merged environment.')
  await rClient.sessionReset()
  const loaded = await rClient.snapshotLoad(merged)
  if (loaded.success === false) throw new Error(loaded.error ?? 'R could not load the merged environment.')
  const listed = await rClient.listEnvironments()
  if (listed.success) useEnvironmentStore.getState().setEnvironments(listed.environments)
}

async function applyFiles(path: string, items: MergeItem[], choices: MergeChoices): Promise<void> {
  const fileItems = items.filter(i => i.kind === 'file') as MergeItem<ProjectFileEntry>[]
  const adopt: string[] = [], keepBoth: string[] = [], remove: string[] = []
  for (const item of fileItems) {
    const side = resolvedSide(item, choices[`file:${item.key}`] as WholeChoice)
    if (side === 'theirs') { if (item.theirs) adopt.push(item.key); else if (item.mine) remove.push(item.key) }
    if (side === 'both' && item.theirs) { if (item.mine) keepBoth.push(item.key); else adopt.push(item.key) }
  }
  if (adopt.length || keepBoth.length) await window.electronAPI.project.adoptFiles(path, adopt, keepBoth)
  if (remove.length) await window.electronAPI.projectFiles.remove(remove, (await window.electronAPI.context.lease()).id)
}

// ── The flow ──────────────────────────────────────────────────────────────────
export async function startMerge(path: string): Promise<boolean> {
  if (useProjectStore.getState().path !== path) {
    if (!await loadProjectFromPath(path, { draft: 'mine' })) return false
  } else await flushDraft()
  const basePath = await window.electronAPI.drafts.basePath(path)
  if (!basePath) {
    await ask({ title: 'Conflicts cannot be resolved here', body: 'This project\'s unsaved changes were made before ouRGeo kept a copy of the project as it was opened, so there is nothing to compare both versions against. Save your version over theirs, or discard it and open theirs.', choices: [{ id: 'ok', label: 'OK', variant: 'primary' }], cancelId: 'ok' })
    return false
  }
  const tokens: string[] = []
  try {
    const theirs = await inspect(path); tokens.push(theirs.token)
    const base = await inspect(basePath); tokens.push(base.token)
    const { items, rUnavailable } = await plan(base, theirs)
    const choices = await askUser(path, items, rUnavailable)
    if (!choices) { await rClient.mergeEnvRelease().catch(() => undefined); return false }
    applyDocs(items, choices, theirs.ui.session?.tabs ?? [])
    const whole = wholeChoices(choices)
    const layerTaken = new Set(useSpatialStore.getState().layers.map(l => l.name))
    useSpatialStore.setState({ layers: mergeList<SpatialLayer>(useSpatialStore.getState().layers, theirs.ui.workspace?.layers ?? [], items.filter(i => i.kind === 'layer') as MergeItem<SpatialLayer>[], whole, l => l.id,
      l => { const name = mineName(l.name, n => layerTaken.has(n)); layerTaken.add(name); return { ...l, id: crypto.randomUUID(), name } }) })
    const plots = mergeList<PlotEntry>(livePlots(), normalizePersistedPlots(theirs.ui.plots?.plots), items.filter(i => i.kind === 'plot') as MergeItem<PlotEntry>[], whole, plotKey, p => ({ ...p, plotId: p.plotId ? `${p.plotId}_mine` : null }))
    usePlottingStore.setState({ plots, currentIndex: plots.length - 1 })
    const chats = mergeList<AiChat>(useAiStore.getState().chats, theirs.ui.chats?.chats ?? [], items.filter(i => i.kind === 'chat') as MergeItem<AiChat>[], whole, c => c.id, c => ({ ...c, id: crypto.randomUUID(), title: `${c.title || 'Chat'}_mine`, renamed: true }))
    useAiStore.getState().loadChats(chats, useAiStore.getState().activeChatId)
    await applyR(items, choices)
    await applyFiles(path, items, choices)
    useProjectStore.getState().markDirty()
    useSessionStore.getState().addConsoleEntry('info', `Merged ${items.length} changed item${items.length === 1 ? '' : 's'} from the version of ${path} saved elsewhere.`)
    return await saveOverExternalChange(path)
  } catch (error) {
    useSessionStore.getState().addConsoleEntry('error', `Resolving conflicts failed: ${String(error)}. Your version is still open and nothing was saved.`)
    return false
  } finally {
    for (const token of tokens) await window.electronAPI.project.releaseOpen(token).catch(() => undefined)
  }
}

/** What Revert would discard, counted against the saved bundle (§1.6). */
export async function revertLosses(path: string): Promise<string[]> {
  const parts: string[] = []
  const n = (count: number, one: string, many: string): void => { if (count) parts.push(`${count} ${count === 1 ? one : many}`) }
  n(useEditorStore.getState().tabs.filter(hasUnsavedEdits).length, 'document with unsaved edits', 'documents with unsaved edits')
  let saved: Inspected | null = null
  try {
    saved = await inspect(path)
    try {
      const res = await rClient.mergeEnvCompare({ base: saved.env, mine: 'live', theirs: saved.env })
      n((res.items ?? []).filter(item => !item.mineEqBase).length, 'R object changed', 'R objects changed')
    } catch { /* R unavailable: not counted */ }
    finally { await rClient.mergeEnvRelease().catch(() => undefined) }
    const same = <T>(a: T[], b: T[], key: (x: T) => string): number => planKeyed('layer', a, b, a, key, () => '').length
    n(same(saved.ui.workspace?.layers ?? [], useSpatialStore.getState().layers, l => l.id), 'map layer', 'map layers')
    n(same(normalizePersistedPlots(saved.ui.plots?.plots), livePlots(), plotKey), 'plot', 'plots')
    n(same(withMessages(saved.ui.chats?.chats), withMessages(useAiStore.getState().chats), c => c.id), 'chat', 'chats')
  } catch { /* the bundle could not be read: count only the documents */ }
  finally { if (saved) await window.electronAPI.project.releaseOpen(saved.token).catch(() => undefined) }
  return parts
}
