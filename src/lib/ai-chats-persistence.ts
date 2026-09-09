import { useAiStore, type AiChat } from '@/store/ai'
import { useProjectStore } from '@/store/project'
import { getDataPath } from '@/lib/persistence'

/**
 * Where the AI panel's conversations are kept.
 *
 * Modelled on `session-persistence.ts`, which already solves the problem this
 * has: one slice of state with TWO homes. Scratch's chats live in
 * `ai-chats.json`; a named project's live in its `.ourgeoproj`, and the same
 * build/apply pair serves both.
 *
 * **Not session-scoped.** `ai-chats.json` must never join the `will-quit`
 * delete list in `electron/main/index.ts` — that list is for state a clean
 * exit should forget (plots, layers, console tail). A conversation is history,
 * and the whole point of this feature is that it is still there tomorrow. It
 * sits on the same side of that line as `session.json`.
 */

export interface ChatsData {
  chats: AiChat[]
  activeChatId: string | null
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

async function getChatsPath(): Promise<string> {
  return `${await getDataPath()}/ai-chats.json`
}

/** Shape the store's chats into the persisted form. Reused by both the
 *  `ai-chats.json` autosave and the project bundle. */
export function buildChatsData(): ChatsData {
  const { chats, activeChatId } = useAiStore.getState()
  return { chats, activeChatId }
}

/**
 * Restore chats, from a file or from a bundle.
 *
 * Returns false when there was nothing usable, so a caller can tell "no chats
 * were restored" from "chats were restored and one of them is empty" — the
 * difference between falling back to scratch's file and not.
 *
 * A chat is dropped rather than trusted when it has no id or no message array:
 * a hand-edited or truncated file must leave a usable panel, not a switcher
 * full of rows that crash when opened.
 */
export function applyChatsData(data: ChatsData | undefined | null): boolean {
  const chats = Array.isArray(data?.chats)
    ? data.chats.filter((c): c is AiChat =>
        !!c && typeof c.id === 'string' && Array.isArray(c.messages))
    : []
  if (chats.length === 0) return false
  useAiStore.getState().loadChats(chats, data?.activeChatId ?? null)
  return true
}

/** Put the panel back to a single empty conversation — what a project load or
 *  New Project starts from, so one project never inherits another's chats. */
export function resetChats(): void {
  useAiStore.getState().loadChats([], null)
}

export async function saveChats(): Promise<void> {
  // Same gate as `saveSession`: `ai-chats.json` holds the SCRATCH project's
  // chats only. While a named project is active its chats live in the bundle,
  // so scratch's are left untouched here — which is what lets them still be
  // there after a switch into a project and back out again.
  if (useProjectStore.getState().path !== null) return
  try {
    await window.electronAPI.file.write(
      await getChatsPath(), JSON.stringify(buildChatsData()),
    )
  } catch (err) {
    console.warn('[AI chats] Failed to save:', err)
  }
}

export function saveChatsImmediate(): void {
  if (saveTimer) clearTimeout(saveTimer)
  void saveChats()
}

export async function loadChats(): Promise<boolean> {
  try {
    const raw = await window.electronAPI.file.read(await getChatsPath())
    return applyChatsData(JSON.parse(raw) as ChatsData)
  } catch {
    // No file yet, or an unreadable one — the store's own empty chat stands.
    return false
  }
}

export function setupChatsAutosave(): () => void {
  const unsub = useAiStore.subscribe((state, prev) => {
    // `chats` identity only, never `streamingContent`: that changes per token,
    // and a save scheduled on each one would rewrite the file hundreds of
    // times per answer. The finished message lands in `chats`, which is the
    // moment worth writing.
    if (state.chats === prev.chats && state.activeChatId === prev.activeChatId) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { void saveChats() }, 2000)
  })
  return () => {
    if (saveTimer) clearTimeout(saveTimer)
    unsub()
  }
}
