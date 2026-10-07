import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { MessagesSquare, Pencil, Check, Trash2, Plus, Loader2 } from 'lucide-react'
import { useAiStore, type AiChat } from '@/store/ai'
import { useProjectStore } from '@/store/project'
import { PROVIDER_LABELS } from '@/lib/ai-client'
import { cn } from '@/lib/utils'
import { useContextStore } from '@/store/context'
import { conversationMemories } from '@/lib/context/conversation-deletion'

/**
 * The list of conversations in this project, and the way between them.
 *
 * Modelled on `spatial/SessionManagerDropdown.tsx` — the switcher this app
 * already has — so the two gestures match: click a row to switch, a pencil to
 * rename in place, a bin to delete behind a confirm, and a "New" row at the
 * bottom.
 *
 * Rendered through a portal, like `TabBar`'s dropdown: the AI panel is a
 * narrow column with `overflow-y-auto` on its message list, and a popup
 * positioned inside it would be clipped by the first ancestor that scrolls.
 */

/** "3 minutes ago" — enough to tell this morning's chat from last week's,
 *  which is what the switcher is for. Exact times belong in a tooltip. */
function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 7 ? `${d}d ago` : new Date(ts).toLocaleDateString()
}

function ChatRow({ chat, isActive, isStreaming, onSwitch, onRename, onDelete }: {
  chat: AiChat
  isActive: boolean
  isStreaming: boolean
  onSwitch: () => void
  onRename: (title: string) => void
  onDelete: () => void
}): React.ReactElement {
  const [renaming, setRenaming] = useState(false)
  const [value, setValue] = useState(chat.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (renaming) inputRef.current?.select() }, [renaming])

  const commit = (): void => {
    setRenaming(false)
    if (value.trim() && value.trim() !== chat.title) onRename(value)
  }

  return (
    <li
      className={cn(
        'group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-geo-bg',
        isActive && 'bg-geo-accent/5',
      )}
      onClick={() => { if (!renaming) onSwitch() }}
    >
      <span className={cn(
        'w-1.5 h-1.5 rounded-full flex-shrink-0',
        isActive ? 'bg-geo-accent' : 'bg-transparent',
      )} />

      <div className="flex-1 min-w-0">
        {renaming ? (
          <input
            ref={inputRef}
            className="w-full bg-geo-bg border border-geo-accent text-xs text-foreground rounded px-1 py-0 outline-none"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit() }
              // Escape abandons the edit; the old title stands.
              if (e.key === 'Escape') { e.preventDefault(); setValue(chat.title); setRenaming(false) }
            }}
          />
        ) : (
          <>
            <div className={cn('truncate text-xs', isActive ? 'text-geo-accent' : 'text-foreground')}>
              {chat.title}
            </div>
            {/* The model matters here and nowhere else: a conversation written
                by Opus and one written by a local 8B are not the same thing,
                and this is where you choose which one to continue. */}
            <div className="truncate text-[10px] text-geo-muted">
              {chat.messages.length === 0 ? 'empty' : `${chat.messages.length} messages`}
              {' · '}{ago(chat.updatedAt)}
              {chat.model ? ` · ${chat.model}` : ` · ${PROVIDER_LABELS[chat.provider] ?? chat.provider}`}
            </div>
          </>
        )}
      </div>

      {isStreaming && <Loader2 className="w-3 h-3 flex-shrink-0 text-geo-accent animate-spin" />}

      {!renaming && (
        <>
          <button
            className="opacity-0 group-hover:opacity-100 p-0.5 text-geo-muted hover:text-foreground flex-shrink-0"
            title="Rename this chat"
            onClick={(e) => { e.stopPropagation(); setValue(chat.title); setRenaming(true) }}
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            className="opacity-0 group-hover:opacity-100 p-0.5 text-geo-muted hover:text-geo-error flex-shrink-0"
            title="Delete this chat"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </>
      )}
      {renaming && (
        <button
          className="p-0.5 text-geo-muted hover:text-foreground flex-shrink-0"
          onMouseDown={(e) => { e.preventDefault(); commit() }}
        >
          <Check className="w-3 h-3" />
        </button>
      )}
    </li>
  )
}

export function AiChatSwitcher(): React.ReactElement {
  const chats = useAiStore((s) => s.chats)
  const activeChatId = useAiStore((s) => s.activeChatId)
  const isStreaming = useAiStore((s) => s.isStreaming)
  const switchChat = useAiStore((s) => s.switchChat)
  const renameChat = useAiStore((s) => s.renameChat)
  const globals = useContextStore(s => s.globals)
  const projectMemory = useContextStore(s => s.projectContext.memories)
  const contextReady = useContextStore(s => s.ready)
  const newChat = useAiStore((s) => s.newChat)
  // `path === null` IS scratch — the sentinel the whole project layer uses.
  const isScratch = useProjectStore((s) => s.path === null)

  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [keepIndependent, setKeepIndependent] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (btnRef.current?.contains(e.target as Node)) return
      if (popRef.current?.contains(e.target as Node)) return
      setOpen(false); setConfirmId(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { setOpen(false); setConfirmId(null) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (): void => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
    setOpen((v) => !v)
    setConfirmId(null)
  }

  // Newest first: the chat you want is almost always one you touched recently,
  // and the list grows without limit at the other end.
  const ordered = [...chats].sort((a, b) => b.updatedAt - a.updatedAt)
  const pending = confirmId ? chats.find((c) => c.id === confirmId) ?? null : null
  const related = pending ? conversationMemories(pending, [...globals, ...projectMemory]) : { dependent: [], independent: [] }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        data-ourgeo-id="ai.chatSwitcher"
        title="Switch between this project's chats"
        className={cn(
          'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 transition-colors',
          open ? 'text-foreground bg-white/5' : 'text-geo-muted hover:text-foreground hover:bg-white/5',
        )}
      >
        <MessagesSquare className="w-3 h-3" />
        {chats.length}
      </button>

      {open && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-[9999] w-72 bg-geo-panel border border-geo-border rounded shadow-lg flex flex-col"
        >
          {pending ? (
            // In place rather than a separate dialog: the popup already has
            // the user's attention, and a modal over a modal is a lot of
            // ceremony for deleting one conversation.
            <div className="p-3 space-y-2">
              <p className="text-xs text-foreground">
                Delete “{pending.title}”?
              </p>
              <p className="text-[10px] text-geo-muted">
                {pending.messages.length === 0
                  ? 'It is empty.'
                  : `${pending.messages.length} messages will be lost. This cannot be undone.`}
              </p>
              <p className="text-[10px] text-geo-muted">{contextReady ? `${related.dependent.length - (keepIndependent ? related.independent.length : 0)} memories derived solely from this chat will also be forgotten.` : 'Loading local memory settings…'}</p>
              {related.independent.length > 0 && <label className="flex gap-1 text-[10px] text-geo-muted">
                <input type="checkbox" checked={keepIndependent} disabled={deleting} onChange={event => setKeepIndependent(event.target.checked)} />
                Keep {related.independent.length} independently edited or pinned memories; their source chat will be removed.
              </label>}
              {deleteError && <p role="status" className="text-[10px] text-geo-error">{deleteError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  className="text-[11px] px-2 py-1 rounded text-geo-muted hover:text-foreground hover:bg-white/5"
                  disabled={deleting}
                  onClick={() => setConfirmId(null)}
                >Cancel</button>
                <button
                  className="text-[11px] px-2 py-1 rounded bg-geo-error/15 text-geo-error hover:bg-geo-error/25"
                  disabled={deleting || !contextReady}
                  onClick={() => {
                    setDeleting(true); setDeleteError('')
                    void useContextStore.getState().deleteConversation(pending.id, keepIndependent)
                      .then(() => setConfirmId(null), error => setDeleteError(String(error)))
                      .finally(() => setDeleting(false))
                  }}
                >{deleting ? 'Deleting…' : 'Delete'}</button>
              </div>
            </div>
          ) : (
            <>
              <ul className="flex flex-col max-h-72 overflow-y-auto">
                {ordered.map((c) => (
                  <ChatRow
                    key={c.id}
                    chat={c}
                    isActive={c.id === activeChatId}
                    isStreaming={isStreaming && c.id === activeChatId}
                    onSwitch={() => { switchChat(c.id); setOpen(false) }}
                    onRename={(t) => renameChat(c.id, t)}
                    onDelete={() => { setConfirmId(c.id); setKeepIndependent(false); setDeleteError('') }}
                  />
                ))}
              </ul>
              {/* Said here rather than on the way out, because here is where
                  the user is looking at the conversations and can act on it.
                  A prompt at quit would be the first mention of a rule that
                  had already been in force for the whole session. */}
              {isScratch && (
                <p className="px-2 py-1.5 text-[10px] text-geo-muted border-t border-geo-border leading-snug">
                  Scratch chats are not kept — they go when you quit.
                  <br />
                  Save this as a project to keep them.
                </p>
              )}
              <button
                className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-geo-muted hover:text-foreground hover:bg-geo-bg border-t border-geo-border"
                onClick={() => { newChat(); setOpen(false) }}
              >
                <Plus className="w-3 h-3" />
                New chat
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
