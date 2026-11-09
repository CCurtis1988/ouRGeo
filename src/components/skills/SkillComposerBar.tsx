import React, { useMemo } from 'react'
import { X } from 'lucide-react'
import { useAiStore } from '@/store/ai'
import { useSkillStore, type AgentSkillNotice } from '@/store/skills'
import { useUiStore } from '@/store/ui'
import { offeredSkills } from '@/lib/skills/catalog'

// Above the message box: the skills in use in this chat, and a picker when the
// message starts with "/". Naming a skill is the most reliable way to get it in
// front of the assistant, so the picker lists every skill that is on, including
// ones set to "Only when I ask for it".
export function SkillComposerBar({ input, setInput }: { input: string; setInput: (value: string) => void }): React.ReactElement | null {
  const revision = useSkillStore(s => s.revision)
  const activeSkills = useAiStore(s => s.chats.find(c => c.id === s.activeChatId)?.activeSkills)
  const deactivate = useAiStore(s => s.deactivateSkill)
  const offered = useMemo(() => offeredSkills(), [revision]) // eslint-disable-line react-hooks/exhaustive-deps
  const names = new Map(offered.map(s => [s.sourceId, s.name]))
  const active = (activeSkills ?? []).filter(id => names.has(id))

  const notices = useSkillStore(s => s.agentNotices)
  const slash = input.match(/^\/([a-z0-9:-]*)$/i)
  const suggestions = slash ? offered.filter(s => s.name.startsWith(slash[1].toLowerCase())).slice(0, 8) : []

  if (!active.length && !suggestions.length && !notices.length) return null
  return (
    <div className="mb-1 space-y-1">
      {notices.map(notice => <AgentNotice key={notice.id} notice={notice} />)}
      {suggestions.length > 0 && (
        <ul className="border border-geo-border rounded bg-geo-panel max-h-40 overflow-y-auto" role="listbox" aria-label="Skills">
          {suggestions.map(s => (
            <li key={s.sourceId}>
              <button type="button" onClick={() => setInput(`/${s.name} `)} className="w-full text-left px-2 py-1 hover:bg-white/5">
                <span className="text-xs text-foreground">/{s.name}</span>
                <span className="block text-[10px] text-geo-muted truncate">{s.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {active.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="Skills in use in this chat">
          {active.map(id => (
            <span key={id} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-geo-border text-geo-muted" title="In use in this chat: the assistant gets it with every message">
              {names.get(id)}
              <button type="button" onClick={() => deactivate(id)} aria-label={`Stop using ${names.get(id)}`} className="hover:text-foreground"><X className="w-2.5 h-2.5" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const VERB = { created: 'saved a new skill', updated: 'changed the skill', archived: 'archived the skill' } as const

/** The assistant saves skills without asking (the maintainer's choice), so the user is told at once, with a way to look and a way back. */
function AgentNotice({ notice }: { notice: AgentSkillNotice }): React.ReactElement {
  const [error, setError] = React.useState('')
  const { dismissAgentNotice, undoAgentChange } = useSkillStore.getState()
  return (
    <div role="status" className="flex items-center gap-2 text-[10px] px-2 py-1 rounded border border-geo-accent text-foreground">
      <span className="flex-1 min-w-0">The assistant {VERB[notice.verb]} <span className="font-medium">{notice.name}</span>.{error && <span className="text-geo-error"> {error}</span>}</span>
      <button type="button" className="text-geo-accent hover:underline" onClick={() => { useUiStore.getState().showDialog('skills', `skill:${notice.id}`); dismissAgentNotice(notice.id) }}>Review</button>
      <button type="button" className="text-geo-muted hover:text-foreground" onClick={() => { const r = undoAgentChange(notice); if (!r.ok) setError(r.error) }}>Undo</button>
      <button type="button" aria-label="Dismiss" className="text-geo-muted hover:text-foreground" onClick={() => dismissAgentNotice(notice.id)}><X className="w-2.5 h-2.5" /></button>
    </div>
  )
}
