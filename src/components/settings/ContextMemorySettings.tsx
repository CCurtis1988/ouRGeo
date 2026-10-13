import { SettingsPages } from './SettingsPages'
import { AiProviderSettings } from './AiProviderSettings'
import { Switch } from '@/components/ui/switch'
import { useContextStore } from '@/store/context'
import { ContextFolders } from './ContextFolders'
import { StorageRecoverySettings } from './StorageRecoverySettings'
import { MemoryLibrary } from '@/components/ai/MemoryLibrary'
import type { ContextEffort } from '@/lib/context/types'
import type { LearningPolicy } from '@/lib/context/learning'
import { useEditorStore } from '@/store/editor'
import { useAiStore } from '@/store/ai'
import { MemoryConnections } from './MemoryConnections'
import { ManagedMemoryRuntime } from './ManagedMemoryRuntime'
import { MaintenanceBudget } from './MaintenanceBudget'
import { ChatBudget } from './ChatBudget'
import { MemoryCleanup } from './MemoryCleanup'
import { ColumnDisclosureSettings } from './ColumnDisclosureSettings'

export function ContextMemorySettings(): React.ReactElement {
  const scopeLease = useContextStore(s => s.scopeLease)
  const effort = useContextStore(s => s.effort)
  const setEffort = useContextStore(s => s.setEffort)
  const learning = useContextStore(s => s.learning)
  const setLearning = useContextStore(s => s.setLearning)
  const savedExclusions = useContextStore(s => s.savedExclusions)
  const exclude = useContextStore(s => s.exclude)
  const exclusionsLoaded = useContextStore(s => s.exclusionsLoaded)
  const refreshExclusions = useContextStore(s => s.refreshExclusions)
  const globals = useContextStore(s => s.globals)
  const traceRetentionDays = useContextStore(s => s.traceRetentionDays)
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
  return <section aria-label="Context and memory" className="h-full">
    <SettingsPages label="AI assistant settings" initialPage="library" pages={[
      { id: 'library', title: 'Memory Library', headingPlacement: 'content', description: 'Add, review and organise your personal, project and conversation memories. Also available below the assistant conversation.', content: <MemoryLibrary placement="settings" /> },
      { id: 'provider', title: 'Provider & model', description: 'Choose your assistant, connection and model.', content: <AiProviderSettings /> },
      { id: 'learning', title: 'Learning & context', description: 'Choose how much context the assistant retrieves and when it remembers information.', content: <div className="space-y-3 rounded-lg border border-geo-border bg-geo-bg/40 p-4">
    <label className="flex items-center justify-between text-xs">Context effort
      <select aria-label="Default context effort" value={effort} onChange={e => setEffort(e.target.value as ContextEffort)} className="bg-geo-bg border border-geo-border rounded p-1">
        <option value="efficient">Efficient</option><option value="balanced">Balanced</option><option value="thorough">Thorough</option>
      </select>
    </label>
    <p className="text-[11px] text-geo-muted">Effort changes retrieval depth, not permissions. Learning uses local rules for declared units, communication and output preferences; no paid extractor runs.</p>
    <label className="flex items-center justify-between gap-2 text-xs">Personal memory learning
      <select aria-label="Global memory learning" value={learning.globalLearning} onChange={e => void setLearning({ ...learning, globalLearning: e.target.value as LearningPolicy }).catch(() => undefined)} className="bg-geo-bg border border-geo-border rounded p-1">{choices}</select>
    </label>
    <label className="flex items-center justify-between gap-2 text-xs">Project memory learning
      <select aria-label="Project memory learning" value={learning.projectLearning} onChange={e => void setLearning({ ...learning, projectLearning: e.target.value as LearningPolicy }).catch(() => undefined)} className="bg-geo-bg border border-geo-border rounded p-1">
        <option value="asked">Remember only when I ask</option><option value="suggest">Suggest project decisions</option><option value="automatic">Automatically remember declared decisions</option>
      </select>
    </label>
    <Switch checked={learning.scratchLearning} onChange={checked => void setLearning({ ...learning, scratchLearning: checked }).catch(() => undefined)} label="Allow preference learning from scratch conversations" />
    <p className="text-[11px] text-geo-muted">Suggestions are used only after you accept them in the Memory Library. Save the project to keep project memories. You can add memories directly without running a model.</p>
      </div> },
      { id: 'privacy', title: 'Privacy & sources', description: 'Control which workspace sources and column metadata the assistant may use, and authorise reference folders.', content: <div className="space-y-3">
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
    <ColumnDisclosureSettings />
    {scopeLease && <ContextFolders api={window.electronAPI.context} lease={scopeLease} />}
      </div> },
      { id: 'budgets', title: 'Budgets', description: 'Set estimated chat limits and optional memory maintenance limits. These controls are separate from the model’s context window.', content: <div className="space-y-3"><ChatBudget /><MaintenanceBudget /></div> },
      { id: 'storage', title: 'Storage & recovery', description: 'Back up local memory, recover protected storage and check cleanup. Personal memory uses your OS keyring; project files and readable exports can contain memory text.', content: <div className="space-y-3">
        <StorageRecoverySettings />
        <MemoryCleanup />
        <div className="space-y-2 rounded-lg border border-geo-border p-4">
          <h4 className="text-xs font-semibold text-foreground">Context diagnostics</h4>
    <label className="flex items-center justify-between gap-2 text-xs">Diagnostic evidence retention
      <select aria-label="Diagnostic evidence retention" value={traceRetentionDays} onChange={e => void useContextStore.getState().setTraceRetentionDays(Number(e.target.value)).catch(() => undefined)} className="bg-geo-bg border border-geo-border rounded p-1">
        {[1, 3, 7].map(days => <option key={days} value={days}>{days} day{days === 1 ? '' : 's'}</option>)}
      </select>
    </label>
    <p className="text-[11px] text-geo-muted">Old context excerpts expire; content-free token receipts remain for accounting. This does not delete chat messages, memories, backups or exported files.</p>
        </div>
      </div> },
      { id: 'advanced', title: 'Advanced', description: 'Optional memory connections and experimental local engines. The built-in Memory Library works without these.', content: <div className="space-y-3"><MemoryConnections /><ManagedMemoryRuntime /></div> },
    ]} />
  </section>
}
