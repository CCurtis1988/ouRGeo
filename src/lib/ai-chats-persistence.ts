import { useAiStore, type AiChat } from '@/store/ai'
import { useProjectStore } from '@/store/project'
import { getDataPath } from '@/lib/persistence'

/**
 * Where the AI panel's conversations are kept.
 *
 * One slice of state with two homes, the shape `session-persistence.ts`
 * already solves: `buildChatsData`/`applyChatsData` serve both the
 * `ai-chats.json` autosave and the `.ourgeoproj` bundle.
 *
 * **Scratch does not keep chats, and that is the point of scratch.** It is the
 * workspace ouRGeo always launches into — a clean R session every time, never
 * savable in place — and a conversation worth keeping is a reason to make a
 * real project out of it: Save As, and from then on the chats travel with the
 * project and are there next time it is opened. Scratch that quietly
 * accumulated every conversation the user ever had in it would be a filing
 * cabinet nobody chose to open.
 *
 * So `ai-chats.json` is **session-scoped**: it is in the `will-quit` delete
 * list (`electron/main/index.ts`), beside `plots.json` and `console.json`.
 * That is not the same as "never written". It is written while the user is
 * working, so a renderer reload — Ctrl+R, or the automatic one when the
 * renderer dies — does not cost them the conversation, and a crash leaves it
 * for recovery. Every other panel in ouRGeo behaves that way; a chat that
 * alone did not would be the one thing a reload destroyed.
 *
 * A NAMED project's chats are a different thing entirely: they live in the
 * bundle, are kept for good, and travel with the file.
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
  // Scratch only. A named project's chats live in its bundle and are written
  // by a save, not by this; writing them here as well would leave a copy on
  // disk that the next launch — which opens scratch — would read back as
  // scratch's own.
  if (useProjectStore.getState().path !== null) return
  try {
    await window.electronAPI.file.write(
      await getChatsPath(), JSON.stringify(buildChatsData()),
    )
  } catch (err) {
    console.warn('[AI chats] Failed to save:', err)
  }
}

/**
 * There is deliberately NO flush on the way out.
 *
 * A write started as the window closes races the `will-quit` handler that
 * deletes this file, and the loser is whichever the OS schedules second — so
 * an exit could leave scratch's chats on disk for the next launch to read.
 * The debounced saves during the session are what reload recovery needs, and
 * that is all this file is for. `workspace-persistence.ts` omits its
 * `beforeunload` flush for exactly this reason.
 */

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
