// Reading the project's other conversations.
//
// ── Why this group is read-only, and stays that way ───────────────────────
//
// The rule these actions sit just inside is recorded in CLAUDE.md: the AI
// panel itself is never exposed, because "an assistant that can close its own
// panel can end the conversation". Switching or deleting a chat is that
// hazard one step worse — it does not merely hide the conversation, it moves
// the user out of it, and a model that misreads a request could take the
// history of somebody's afternoon with it.
//
// What is genuinely useful, and carries none of that, is LOOKING: "what did we
// decide about the buffer distance last week?" is a question the answer to is
// sitting in this project and nowhere else. So the group lists and reads, and
// there is deliberately no `chat:switch`, `chat:new`, `chat:rename` or
// `chat:delete`. Adding one later is a decision to be argued on its own, not
// a gap to be filled for symmetry.
//
// Both actions are `always` tier: they touch neither R nor disk, and they read
// only what the user can already see by clicking the switcher.

import { ok, fail, argStr, type UiAction } from './types'
import { useProjectStore } from '@/store/project'
import { useAiStore } from '@/store/ai'
import { truncateForModel } from '@/lib/ai-client'

/** How much of one conversation to hand back. Generous — the point of reading
 *  an old chat is the detail — but bounded, because a long autopilot session
 *  can run to tens of thousands of characters and would crowd out the question
 *  that prompted the lookup. */
const MAX_CHAT_CHARS = 20_000

function when(ts: number): string {
  return new Date(ts).toLocaleString()
}

export const chatActions: UiAction[] = [
  {
    id: 'chat:list',
    group: 'chat',
    summary:
      'List the AI chats saved in this project — their titles, when they were last used, how long they are, and which model each was held with.',
    params: [],
    tier: 'always',
    run: () => {
      const { chats: allChats, activeChatId } = useAiStore.getState()
      const chats = useProjectStore.getState().path ? allChats : allChats.filter(c => c.id === activeChatId)
      const rows = [...chats]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((c) => {
          const here = c.id === activeChatId ? ' — THIS conversation' : ''
          const size = c.messages.length === 0 ? 'empty' : `${c.messages.length} messages`
          return `${c.id} — "${c.title}" (${size}, last used ${when(c.updatedAt)}, `
            + `${c.model || c.provider})${here}`
        })
      return ok(
        `${chats.length} chat${chats.length === 1 ? '' : 's'} in this project:`,
        `${rows.join('\n')}\n\nUse chat:read with an id to read one. `
        + 'You cannot switch or delete chats — that is the user\'s to do, from the '
        + 'chat switcher in the AI panel header.',
      )
    },
  },

  {
    id: 'chat:read',
    group: 'chat',
    summary:
      'Read an earlier chat from this project, by the id chat:list gives. Use it to recall what was decided in a previous conversation.',
    params: [
      {
        name: 'id',
        type: 'string',
        required: true,
        description: 'The chat id from chat:list.',
      },
    ],
    tier: 'always',
    run: (args) => {
      const id = argStr(args, 'id')
      const { chats: allChats, activeChatId } = useAiStore.getState()
      const chats = useProjectStore.getState().path ? allChats : allChats.filter(c => c.id === activeChatId)
      const chat = chats.find((c) => c.id === id)
        // A model that has just been handed a list of titles will reach for a
        // title, so accept one rather than refusing over a formality.
        ?? chats.find((c) => c.title.toLowerCase() === id.trim().toLowerCase())
      if (!chat) {
        return fail(
          `No chat with id or title "${id}" in this project. Use chat:list to see what there is.`,
        )
      }
      if (chat.id === activeChatId) {
        return fail(
          'That is the conversation you are already in — its messages are above. '
          + 'Use chat:list to find a different one.',
        )
      }
      if (chat.messages.length === 0) return ok(`"${chat.title}" is empty.`)

      const body = chat.messages
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n')
      return ok(
        `"${chat.title}" — ${chat.messages.length} messages, last used ${when(chat.updatedAt)}, `
        + `held with ${chat.model || chat.provider}:`,
        truncateForModel(body, MAX_CHAT_CHARS),
      )
    },
  },
]
