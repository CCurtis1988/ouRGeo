import { useContextStore } from '@/store/context'
import { MemoryLibrary } from '@/components/ai/MemoryLibrary'
import type { ContextEffort } from '@/lib/context/types'
import type { LearningPolicy } from '@/lib/context/learning'
import { useEditorStore } from '@/store/editor'
import { useAiStore } from '@/store/ai'
import { MemoryConnections } from './MemoryConnections'
import { ManagedMemoryRuntime } from './ManagedMemoryRuntime'

export function ContextMemorySettings(): React.ReactElement {
  const effort = useContextStore(s => s.effort)
  const setEffort = useContextStore(s => s.setEffort)
  const learning = useContextStore(s => s.learning)
  const setLearning = useContextStore(s => s.setLearning)
  const savedExclusions = useContextStore(s => s.savedExclusions)
  const exclude = useContextStore(s => s.exclude)
  const exclusionsLoaded = useContextStore(s => s.exclusionsLoaded)
  const refreshExclusions = useContextStore(s => s.refreshExclusions)
  const globals = useContextStore(s => s.globals)
  const projectContext = useContextStore(s => s.projectContext)
  const tabs = useEditorStore(s => s.tabs)
  const chats = useAiStore(s => s.chats)
  const sourceLabel = (id: string): string => {
    const [kind, ...parts] = id.split(':')
    if (kind === 'memory') return `Memory: ${[...globals, ...projectContext.memories].find(memory => memory.id === parts[0])?.statement.slice(0, 120) ?? 'unavailable record'}`
    if (kind === 'document') return `Document: ${tabs.find(tab => tab.id === parts[0])?.fileName ?? 'closed document'}`
    if (kind === 'conversation') return `Conversation: ${chats.find(chat => encodeURIComponent(chat.id) === parts[0])?.title ?? 'unavailable conversation'}`
    if (kind === 'console') return 'Console execution'
    if (kind === 'environment') {
      try { return `Workspace object: ${parts.map(part => decodeURIComponent(part)).join('::')}` }
      catch { return 'Workspace object' }
    }
    return `${kind === 'skill' ? 'Guidance' : 'Action'}: ${parts.join(':')}`
  }
  const choices = <><option value="asked">Remember only when I ask</option><option value="suggest">Suggest useful memories</option><option value="automatic">Automatically remember useful preferences</option></>
  return <section aria-label="Context and memory" className="space-y-2 border-t border-geo-border pt-3">
    <h3 className="text-xs text-foreground">Context &amp; memory</h3>
    <p className="text-[11px] text-geo-muted">Built-in manager, on this device. No model download or paid memory processing is required. Personal memories use your OS keyring; project exports are readable files.</p>
    <label className="flex items-center justify-between text-xs">Context effort
      <select aria-label="Default context effort" value={effort} onChange={e => setEffort(e.target.value as ContextEffort)} className="bg-geo-bg border border-geo-border rounded p-1">
        <option value="efficient">Efficient</option><option value="balanced">Balanced</option><option value="thorough">Thorough</option>
      </select>
    </label>
    <p className="text-[11px] text-geo-muted">Effort changes retrieval depth, not permissions. Learning uses local rules for declared units, communication and output preferences; no paid extractor runs.</p>
    <label className="flex items-center justify-between gap-2 text-xs">About you learning
      <select aria-label="Global memory learning" value={learning.globalLearning} onChange={e => void setLearning({ ...learning, globalLearning: e.target.value as LearningPolicy }).catch(() => undefined)} className="bg-geo-bg border border-geo-border rounded p-1">{choices}</select>
    </label>
    <label className="flex items-center justify-between gap-2 text-xs">Project learning
      <select aria-label="Project memory learning" value={learning.projectLearning} onChange={e => void setLearning({ ...learning, projectLearning: e.target.value as LearningPolicy }).catch(() => undefined)} className="bg-geo-bg border border-geo-border rounded p-1">
        <option value="asked">Remember only when I ask</option><option value="suggest">Suggest project decisions</option><option value="automatic">Automatically remember declared decisions</option>
      </select>
    </label>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={learning.scratchLearning} onChange={e => void setLearning({ ...learning, scratchLearning: e.target.checked }).catch(() => undefined)} />Allow preference learning from scratch conversations</label>
    <p className="text-[11px] text-geo-muted">Suggestions are excluded from assistant retrieval until accepted. Project memories await project save. External memory processing is unavailable.</p>
    <details className="text-[11px] text-geo-muted border border-geo-border rounded p-2">
      <summary className="cursor-pointer">Source exclusions ({savedExclusions.reduce((total, selection) => total + selection.ids.length, 0)})</summary>
      <p className="mt-1">Exclude a source in the Context inspector. Saved-project and reference exclusions stay on this device; scratch exclusions end with its workspace. Previous assistant answers are omitted from future prompts while exclusions apply. Original user messages remain available.</p>
      <p className="mt-1">Assistant execution that could bypass an excluded private source is paused. You can still use the GUI or R console directly. Already sent content cannot be recalled.</p>
      {!exclusionsLoaded && <button className="text-geo-accent mt-1" onClick={() => void refreshExclusions()}>Retry source privacy settings</button>}
      {savedExclusions.flatMap(selection => selection.ids.map(id => <div key={`${selection.scope}:${id}`} className="flex gap-2 mt-1">
        <span className="break-words" title={id}>{sourceLabel(id)} · {selection.scope}</span>
        <button className="text-geo-accent shrink-0" aria-label={`Allow source ${sourceLabel(id)}`} onClick={() => void exclude(id, selection.scope, selection.projectId).catch(() => undefined)}>Allow again</button>
      </div>))}
    </details>
    <MemoryLibrary />
    <MemoryConnections />
    <ManagedMemoryRuntime />
  </section>
}
