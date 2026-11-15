// window.__ourgeoEval — how the skill-training harness drives the real app.
//
// Installed by main.tsx ONLY when preload reports `evalMode` (OURGEO_EVAL=1);
// in a normal launch this module is never imported and the global does not
// exist (absent, not refusing). Everything here goes through the same stores,
// actions and send path the user's clicks do, so a measured episode is a
// production turn. Spec: docs/agent-skill-training-spec.md §4.1.

import { useSkillStore } from '@/store/skills'
import { parseSkillMarkdown } from '@/lib/skills/format'
import { EMPTY_LIBRARY, type SkillMode } from '@/lib/skills/types'
import { evalHooks, overlayValue, type EvalToolCall } from './hooks'
import { applyOverlay, restoreOverlay, type SkillOverlay } from './overlay'
import { useAiStore, type AiProvider } from '@/store/ai'
import { useSessionStore } from '@/store/session'
import { useSpatialStore } from '@/store/spatial'
import { useEditorStore } from '@/store/editor'
import { useUiStore } from '@/store/ui'
import { useLayoutStore } from '@/store/layout'
import { useEnvironmentStore } from '@/store/environment'
import { useThemeStore } from '@/store/theme'
import { usePlottingStore } from '@/store/plotting'
import { rClient } from '@/lib/r-client'
import { actionById, actionList } from '@/lib/ai-actions/registry'
import { useContextStore } from '@/store/context'
import { useProjectStore } from '@/store/project'
import type { ContextEffort, MemoryRecord } from '@/lib/context/types'

const DISCOVERY_TOOLS = new Set(['list_ui_actions', 'toolbox_tools', 'context_search', 'ourgeo_docs', 'use_skill'])

export interface EpisodeOptions {
  mode?: 'episode' | 'probe'
  confirm?: 'approve' | 'decline'
  timeoutMs?: number
}

interface ToolRecord { name: string; input: Record<string, unknown>; result: string; ms: number }

const waitFor = async (test: () => boolean, timeoutMs: number, what: string): Promise<void> => {
  const started = Date.now()
  while (!test()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

async function configure(options: { provider?: AiProvider; model?: string; autopilot?: boolean; web?: boolean; terminal?: boolean; effort?: ContextEffort }): Promise<void> {
  const ai = useAiStore.getState()
  if (options.effort) useContextStore.getState().setEffort(options.effort)
  if (options.provider && ai.provider !== options.provider) ai.setProvider(options.provider)
  if (options.model) useAiStore.getState().setModel(options.model)
  if (options.autopilot !== undefined) ai.setAutoPilot(options.autopilot)
  if (options.web !== undefined) ai.setWebAccess(options.web)
  if (options.terminal !== undefined) ai.setTerminalAccess(options.terminal)
}

/** Resolve once `snapshot()` has not changed for `quietMs`. */
async function settle(snapshot: () => string, quietMs: number, timeoutMs: number): Promise<void> {
  const started = Date.now()
  let last = snapshot(), since = Date.now()
  while (Date.now() - since < quietMs && Date.now() - started < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 100))
    const next = snapshot()
    if (next !== last) { last = next; since = Date.now() }
  }
}

interface FixtureSkill { text: string; mode?: SkillMode; enabled?: boolean; createdBy?: 'user' | 'import' }

function installFixtureSkills(skills: FixtureSkill[]): void {
  useSkillStore.setState({ library: EMPTY_LIBRARY, agentNotices: [] })
  for (const skill of skills) {
    const parsed = parseSkillMarkdown(skill.text)
    if (!parsed.ok) throw new Error(`Fixture skill: ${parsed.error}`)
    const change = useSkillStore.getState().create(parsed.definition, skill.createdBy ?? 'user')
    if (!change.ok) throw new Error(`Fixture skill: ${change.error}`)
    const controls = { ...(skill.mode ? { mode: skill.mode } : {}), ...(skill.enabled !== undefined ? { enabled: skill.enabled } : {}) }
    if (Object.keys(controls).length) useSkillStore.getState().setControls(change.skill.id, controls, 'user')
  }
}

/** A fresh chat, empty R session, no layers, one empty editor tab, wd = `dir`. */
interface FixtureMemory { statement: string; scope?: 'project' | 'global'; pinned?: boolean }
const EVAL_PROJECT = { projectId: '00000000-0000-4000-8000-00000000e7a1', name: 'eval', path: '/eval/eval.ourgeoproj' }

/**
 * Saved memories, set straight into the store as the Memory library leaves them
 * (user-declared, active; project memories are categorised `decision`, as
 * `remember()` does). Project memory exists only in a saved project, so a task
 * with project memories runs as one; a task without memories runs in scratch, as
 * every task did before. Nothing is written to protected storage.
 */
async function installFixtureMemories(memories: FixtureMemory[]): Promise<void> {
  const now = new Date().toISOString()
  const record = (m: FixtureMemory, i: number): MemoryRecord => ({ id: `eval-memory-${i}`, revision: 1, scope: m.scope ?? 'project', projectId: (m.scope ?? 'project') === 'project' ? EVAL_PROJECT.projectId : null,
    category: (m.scope ?? 'project') === 'project' ? 'decision' : 'preference', statement: m.statement, evidence: [], assertion: 'user-declared', createdAt: now, updatedAt: now, status: 'active', supersedes: [], ...(m.pinned || overlayValue<number>('memoryPinAll', 0) === 1 ? { pinned: true } : {}) })
  const records = memories.map(record)
  const project = records.filter(r => r.scope === 'project')
  // The main process holds the context scope a turn's lease is checked against.
  if (project.length) { await window.electronAPI.evalActivateProject?.(EVAL_PROJECT.projectId); useProjectStore.setState({ projectId: EVAL_PROJECT.projectId, name: EVAL_PROJECT.name, path: EVAL_PROJECT.path }) }
  else if (useProjectStore.getState().projectId === EVAL_PROJECT.projectId) { await window.electronAPI.evalActivateProject?.(null); useProjectStore.setState({ projectId: null, name: 'scratch', path: null }) }
  useContextStore.setState({ projectContext: { version: 1, revision: 1, memories: project }, globals: records.filter(r => r.scope === 'global') })
  // Exclusions carry the scope lease; re-read them for the scope just activated.
  await useContextStore.getState().refreshExclusions()
}

async function reset(fixture: { dir: string; r?: string; layers?: string[]; documents?: { fileName: string; content: string; language?: string }[]; skills?: FixtureSkill[]; memories?: FixtureMemory[] }): Promise<{ ok: boolean; output: string }> {
  const ai = useAiStore.getState()
  if (ai.isStreaming) ai.cancelStream()
  useUiStore.getState().confirm?.resolve(false)
  useLayoutStore.getState().setActivePanel('ai')
  useThemeStore.getState().setTheme('dark')
  // Skills are app state that `reset` must clear, or one task's skills (or ones the
  // assistant saved) would carry into the next. Then the task's own are installed.
  installFixtureSkills(fixture.skills ?? [])
  await installFixtureMemories(fixture.memories ?? [])
  useUiStore.getState().setHighlight(null)
  for (const layer of [...useSpatialStore.getState().layers]) useSpatialStore.getState().removeLayer(layer.id)
  const editor = useEditorStore.getState()
  for (const tab of editor.tabs.slice(1)) useEditorStore.getState().closeTab(tab.id)
  for (const doc of fixture.documents ?? []) useEditorStore.getState().newDocumentTab(doc.fileName, doc.content, doc.language as never)
  useAiStore.getState().newChat()
  await rClient.sessionReset()
  await rClient.setWorkingDir(fixture.dir)
  let output = ''
  if (fixture.r) {
    const res = await rClient.execute(fixture.r)
    output = res.output || res.error || ''
    if (res.error && !res.output) return { ok: false, output }
  }
  // A user sends after the Environment panel has shown their objects. Sending
  // before R's environment broadcast lands would measure a race no user meets.
  await settle(() => JSON.stringify(useEnvironmentStore.getState().environments), 1500, 20_000)
  for (const object of fixture.layers ?? []) {
    const result = await actionById('map:addLayer')!.run({ object })
    if (!result.ok) return { ok: false, output: `${output}\nmap:addLayer ${object}: ${result.message}` }
  }
  await settle(() => JSON.stringify(useEnvironmentStore.getState().environments), 1500, 20_000)
  return { ok: true, output }
}

/**
 * How dark a captured plot is: the median luminance (0 black, 1 white) of the
 * whole image and of its outer border. Grading the picture rather than the code
 * catches every way of making a plot dark (a variable passed to par(bg), a theme
 * function, a ggplot theme), which code patterns kept missing.
 */
async function plotLuminance(dataUrl: string): Promise<{ whole: number; border: number } | null> {
  const image = new Image()
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('plot image did not load')); image.src = dataUrl })
  const width = Math.min(image.naturalWidth, 400), height = Math.round(image.naturalHeight * width / image.naturalWidth)
  if (!width || !height) return null
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d'); if (!context) return null
  context.drawImage(image, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height).data
  const whole: number[] = [], border: number[] = [], edge = Math.max(2, Math.round(Math.min(width, height) * 0.03))
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const i = (y * width + x) * 4, value = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255
    whole.push(value)
    if (x < edge || y < edge || x >= width - edge || y >= height - edge) border.push(value)
  }
  const median = (values: number[]): number => { const sorted = [...values].sort((a, b) => a - b); return Math.round(sorted[Math.floor(sorted.length / 2)] * 1000) / 1000 }
  return { whole: median(whole), border: median(border) }
}

async function send(text: string, options: EpisodeOptions = {}) {
  await waitFor(() => Boolean(evalHooks.send), 30_000, 'the AI panel to mount')
  const tools: ToolRecord[] = []
  const consoleStart = useSessionStore.getState().consoleHistory.length
  const plotsBefore = usePlottingStore.getState().plots.length
  const stopConfirm = useUiStore.subscribe(state => {
    if (state.confirm) useUiStore.getState().answerConfirm(options.confirm === 'approve')
  })
  let probe: (EvalToolCall & { result?: string }) | undefined
  const stopTurn = () => { setTimeout(() => useAiStore.getState().cancelStream(), 0) }
  evalHooks.beforeTool = options.mode === 'probe' ? call => {
    if (probe) return 'Probe complete.'
    probe = { name: call.name, input: call.input }
    // A discovery call is graded on what it finds (spec §4.3), so it really runs.
    if (DISCOVERY_TOOLS.has(call.name.replace(/^mcp__ourgeo__/, ''))) return undefined
    // Stop the turn before the tool runs: a probe grades the first call only.
    stopTurn()
    return 'Probe complete.'
  } : undefined
  evalHooks.afterTool = (call, result, ms) => {
    tools.push({ name: call.name, input: call.input, result, ms })
    if (options.mode === 'probe' && probe) { probe.result = result; stopTurn() }
  }
  // R/session transitions during the turn: environment evidence revisions are
  // derived from these, so a change mid-turn explains STALE_REFERENCE results.
  const transitions: { at: number; rStatus: string; rGeneration: number; isExecuting: boolean; inputs: number }[] = []
  const snap = () => { const s = useSessionStore.getState(); return { at: Math.round(performance.now() - started), rStatus: String(s.rStatus), rGeneration: s.rGeneration, isExecuting: Boolean(s.isExecuting), inputs: s.consoleHistory.filter(e => e.type === 'input').length } }
  const started = performance.now()
  transitions.push(snap())
  const stopSession = useSessionStore.subscribe(() => { const n = snap(), l = transitions.at(-1)!; if (n.rStatus !== l.rStatus || n.rGeneration !== l.rGeneration || n.isExecuting !== l.isExecuting || n.inputs !== l.inputs) transitions.push(n) })
  let error: string | null = null
  evalHooks.sendError = null
  try {
    const sending = evalHooks.send!(text)
    await Promise.race([sending, new Promise((_, reject) => setTimeout(() => reject(new Error('EPISODE_TIMEOUT')), options.timeoutMs ?? 600_000))])
    await waitFor(() => !useAiStore.getState().isStreaming, 30_000, 'the turn to settle')
  } catch (e) {
    error = String(e)
    useAiStore.getState().cancelStream()
  } finally {
    stopConfirm()
    stopSession()
    evalHooks.beforeTool = undefined
    evalHooks.afterTool = undefined
  }
  // The panel commits its error line on the next render.
  await new Promise(resolve => setTimeout(resolve, 50))
  const chat = useAiStore.getState().chats.find(c => c.id === useAiStore.getState().activeChatId)
  const messages = chat?.messages ?? []
  const userIndex = messages.map(m => m.role === 'user' && m.content === text).lastIndexOf(true)
  const turn = messages.slice(userIndex).find(m => (m as { contextTrace?: unknown }).contextTrace) as { contextTrace?: unknown } | undefined
  const assistant = messages.slice(userIndex + 1).filter(m => m.role === 'assistant').map(m => m.content).join('\n\n')
  const plots = usePlottingStore.getState().plots
  const lastPlot = plots.length > plotsBefore ? plots[plots.length - 1] : null
  const plot = { made: Math.max(0, plots.length - plotsBefore), luminance: lastPlot ? await plotLuminance(lastPlot.dataUrl).catch(() => null) : null }
  return {
    plot,
    ms: Math.round(performance.now() - started),
    error,
    sendError: evalHooks.sendError ?? null,
    final: assistant,
    probe: probe ?? null,
    tools,
    transitions,
    trace: turn?.contextTrace ?? null,
    tokenUsage: chat?.tokenUsage ?? null,
    console: useSessionStore.getState().consoleHistory.slice(consoleStart).map(e => ({ type: e.type, text: e.text, origin: (e as { origin?: string }).origin })),
  }
}

function state() {
  const spatial = useSpatialStore.getState(), editor = useEditorStore.getState(), ai = useAiStore.getState()
  return {
    layers: spatial.layers.map(layer => ({ id: layer.id, name: layer.name, envName: layer.envName, kind: layer.kind, visible: layer.visible, style: (layer as { style?: unknown }).style, symbology: layer.symbology, labels: layer.labelSettings, opacity: layer.opacity, color: layer.color, geometryType: layer.geometryType })),
    tabs: editor.tabs.map(tab => ({ id: tab.id, fileName: tab.fileName, type: tab.type, language: tab.language ?? 'r', content: tab.content, filePath: tab.filePath })),
    activeTabId: editor.activeTabId,
    workingDir: useSessionStore.getState().workingDir,
    provider: ai.provider, model: ai.currentModel(),
    switches: { autopilot: ai.autoPilotEnabled, web: ai.webAccessEnabled, terminal: ai.terminalEnabled },
    rReady: Boolean(useSessionStore.getState().rPort),
    skills: useSkillStore.getState().library.skills.map(skill => ({ name: skill.definition.name, enabled: skill.enabled, mode: skill.mode, archived: skill.archived, createdBy: skill.createdBy, updatedBy: skill.updatedBy, scope: skill.scope, description: skill.definition.description, body: skill.definition.body })),
    theme: useThemeStore.getState().current,
    // For diagnosing a turn that hangs: is it still streaming, and what did it last log.
    streaming: { active: ai.isStreaming, content: ai.streamingContent.slice(-400) },
    consoleTail: useSessionStore.getState().consoleHistory.slice(-8).map(e => `${e.type}: ${e.text.slice(0, 200)}`),
    project: { path: useProjectStore.getState().path, projectId: useProjectStore.getState().projectId, phase: useProjectStore.getState().phase },
    highlight: useUiStore.getState().highlight,
  }
}

export function installEvalBridge(): void {
  Object.defineProperty(window, '__ourgeoEval', {
    value: Object.freeze({
      configure, reset, send, state,
      overlay: (overlay: SkillOverlay) => applyOverlay(overlay),
      restore: () => restoreOverlay(),
      r: async (code: string) => rClient.execute(code),
      actionIds: () => actionList().map(action => action.id),
      /** Oracle replay: run an action's handler directly, as the tool would. */
      action: async (id: string, params: Record<string, unknown>) => {
        const action = actionById(id)
        if (!action) return `Error: no action ${id}`
        const result = await action.run(params as never)
        return `${result.ok ? '' : 'Failed: '}${result.message}${typeof result.data === 'string' && result.data ? `\n\n${result.data}` : ''}`
      },
      /** Oracle replay of write_document: the active tab's text. */
      document: (content: string) => {
        const editor = useEditorStore.getState(), tab = editor.getActiveTab()
        if (tab) editor.applyExternalContent(tab.id, content)
      },
    }),
  })
}
