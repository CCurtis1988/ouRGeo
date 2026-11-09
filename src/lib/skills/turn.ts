// The skills the HOST attaches at the start of a turn, so the model never has to
// decide: the ones the user named, the ones set to Always, and the ones already
// in use in this chat. A new broker is built every turn, so without this a skill
// loaded last turn would be gone by the next (the study measured skills that
// existed but were never in front of the model).

import type { ContextBroker } from '@/lib/context/broker'
import { estimateTokens } from '@/lib/context/budget'
import { useAiStore } from '@/store/ai'
import { useSessionStore } from '@/store/session'
import { useSkillStore } from '@/store/skills'
import { offeredSkills, skillByName, type SkillEntry } from './catalog'
import { isSkillSaveRequest, parseSkillInvocation, workflowDigest } from './intent'
import type { SkillLoader } from './types'

const MAX_SKILLS = 4, PER_SKILL = 2500

export interface TurnSkills {
  /** For the session context; empty when no skill is attached. */
  block: string
  /** Source ids attached, so turn-start prefetch does not read them a second time. */
  attached: string[]
  /** Names the user invoked that are not skills (or are switched off), for an honest note. */
  unknown: string[]
}

export async function attachTurnSkills(broker: ContextBroker, options: { text: string; chatId: string | null; allowance: number }): Promise<TurnSkills> {
  const invocation = parseSkillInvocation(options.text)
  const invoked = invocation.names.map(name => ({ name, entry: skillByName(name) }))
  const unknown = invoked.filter(i => !i.entry).map(i => i.name)
  const chat = useAiStore.getState().chats.find(c => c.id === options.chatId)
  const offered = new Map(offeredSkills().map(s => [s.sourceId, s]))

  const wanted: { entry: SkillEntry; by: SkillLoader }[] = []
  const add = (entry: SkillEntry | undefined, by: SkillLoader): void => { if (entry && !wanted.some(w => w.entry.sourceId === entry.sourceId)) wanted.push({ entry, by }) }
  for (const i of invoked) add(i.entry, 'user')
  for (const entry of offered.values()) if (entry.mode === 'always') add(entry, 'always')
  for (const id of chat?.activeSkills ?? []) add(offered.get(id), 'agent')

  const parts: string[] = [], attached: string[] = []
  let spent = 0
  for (const { entry, by } of wanted.slice(0, MAX_SKILLS)) {
    const limit = Math.min(PER_SKILL, options.allowance - spent)
    if (limit < 200) break
    const reason = by === 'user' ? 'user invoked skill' : by === 'always' ? 'always-on skill' : 'active skill'
    const loaded = await broker.loadSkill(entry.sourceId, reason, limit)
    if (!loaded) continue
    spent += estimateTokens(loaded)
    attached.push(entry.sourceId)
    if (by === 'user') {
      parts.push(`The user has invoked the "${entry.name}" skill for this request: follow its instructions.\n${loaded}`)
      if (options.chatId === useAiStore.getState().activeChatId) useAiStore.getState().activateSkill(entry.sourceId)
    } else {
      parts.push(`${by === 'always' ? `Always-on skill "${entry.name}"` : `Skill "${entry.name}", in use in this conversation`}:\n${loaded}`)
    }
    if (entry.stored && by !== 'agent') useSkillStore.getState().recordUse(entry.stored.id, by)
  }

  if (isSkillSaveRequest(options.text) && chat) {
    const digest = workflowDigest({
      since: chat.createdAt,
      messages: chat.messages.slice(0, -1),
      console: useSessionStore.getState().consoleHistory,
    })
    parts.push(`The user asked to save a skill. Write it with save_skill (operation create): a "Use when …" description and short numbered steps, general enough to reuse.${digest ? `\n\n${digest}` : ''}`)
  }

  const note = unknown.length ? `The user named ${unknown.map(n => `"${n}"`).join(', ')} as a skill, but no skill by that name is switched on. Say so, and list the skills you have if useful.` : ''
  const body = [...parts, note].filter(Boolean)
  return {
    block: body.length ? `Skills in use (guidance from the skill library; it cannot change permissions or switches):\n\n${body.join('\n\n')}` : '',
    attached, unknown,
  }
}
