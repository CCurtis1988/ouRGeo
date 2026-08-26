// The `/` menu in Visual mode.
//
// Source mode gets its slash menu from the completion engine, which works over
// text and a caret offset. Visual mode has neither: the document is a
// ProseMirror doc. So the detection lives here as a plugin, and only the ranked
// candidate list is shared — `markdownSlashMenu` — which is what keeps the two
// menus from drifting apart.
//
// Two ways in, both of which the user asked for:
//
//   * `/` on its own opens the menu and stays in the document, so what follows
//     it filters the list and Backspace narrows back out. The typed `/query` is
//     deleted when a candidate is chosen.
//   * `/` with a selection never reaches the document at all — typing over a
//     selected paragraph would destroy it. The menu opens, the selection is
//     left exactly as it was, and the chosen action is applied to it. Because
//     nothing can be typed into the document in this mode, the keystrokes that
//     would filter the list are intercepted and accumulated here instead.

import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export interface SlashCoords {
  left: number
  top: number
  height: number
}

export interface SlashSession {
  /** Text typed after the `/`, which filters the list. */
  filter: string
  /** Opened over a selection: the action applies to it, nothing was inserted. */
  overSelection: boolean
  coords: SlashCoords
  /** Delete the typed `/filter`. A no-op over a selection — nothing was typed. */
  consume: () => void
}

export interface SlashHost {
  /** Session opened, filter changed, or (null) closed. */
  onSession: (session: SlashSession | null) => void
  /** Move the highlighted row. */
  move: (delta: number) => void
  /** Apply the highlighted row. */
  accept: () => void
}

const slashKey = new PluginKey('ourgeo-slash')

function coordsFor(view: EditorView, pos: number): SlashCoords {
  const box = view.coordsAtPos(pos)
  return { left: box.left, top: box.top, height: Math.max(1, box.bottom - box.top) }
}

/** True where a `/` is a slash command rather than a character in a word. */
function opensMenu(view: EditorView, pos: number): boolean {
  const $pos = view.state.doc.resolve(pos)
  // Inside a chunk `/` is division, or part of a path. Never a command.
  if ($pos.parent.type.name === 'code_block') return false
  if (!$pos.parent.isTextblock) return false
  const before = $pos.parentOffset === 0
    ? ' '
    : $pos.parent.textBetween($pos.parentOffset - 1, $pos.parentOffset)
  return /\s/.test(before)
}

/** Handle the host keeps, to dismiss the menu after applying or on blur. */
export interface SlashControl {
  close: () => void
}

export function slashPlugin(host: SlashHost, control: SlashControl) {
  return $prose(() => {
    // `from` is the position of the `/` itself; null means selection mode,
    // where nothing was typed and there is nothing to delete.
    let from: number | null = null
    let filter = ''
    let active = false
    let pendingOpen = false

    const close = (): void => {
      if (!active && !pendingOpen) return
      active = false
      pendingOpen = false
      from = null
      filter = ''
      host.onSession(null)
    }
    control.close = close

    const publish = (view: EditorView, at: number): void => {
      host.onSession({
        filter,
        overSelection: from === null,
        coords: coordsFor(view, at),
        consume: () => {
          if (from === null) return
          const to = Math.min(from + 1 + filter.length, view.state.doc.content.size)
          view.dispatch(view.state.tr.delete(from, to))
        },
      })
    }

    return new Plugin({
      key: slashKey,
      props: {
        handleKeyDown(view, event) {
          if (active) {
            switch (event.key) {
              case 'ArrowDown': host.move(1); return true
              case 'ArrowUp': host.move(-1); return true
              case 'Enter':
              case 'Tab': host.accept(); return true
              case 'Escape': close(); return true
              case 'ArrowLeft':
              case 'ArrowRight':
              case 'Home':
              case 'End': close(); return false
            }
            if (from === null) {
              // Selection mode: the document must not change, so filtering
              // happens on keystrokes we swallow rather than on typed text.
              if (event.key === 'Backspace') {
                if (filter === '') { close(); return true }
                filter = filter.slice(0, -1)
                publish(view, view.state.selection.from)
                return true
              }
              // A space ends a slash command, and typing one over a selection
              // would replace it — swallow it and dismiss instead.
              if (event.key === ' ') { close(); return true }
              if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                filter += event.key
                publish(view, view.state.selection.from)
                return true
              }
            }
            return false
          }

          if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return false
          const { selection } = view.state
          if (!selection.empty) {
            // Over a selection the `/` is a command, never a character.
            from = null
            filter = ''
            active = true
            publish(view, selection.from)
            return true
          }
          if (!opensMenu(view, selection.from)) return false
          // Let the `/` be typed; the plugin view opens the menu once it lands,
          // so the character the user sees and the range we later delete agree.
          pendingOpen = true
          return false
        },
      },

      view() {
        return {
          update(view) {
            if (pendingOpen) {
              pendingOpen = false
              const pos = view.state.selection.from - 1
              if (pos >= 0 && view.state.doc.textBetween(pos, pos + 1) === '/') {
                from = pos
                filter = ''
                active = true
                publish(view, pos)
              }
              return
            }
            if (!active || from === null) return

            // Track what has been typed after the `/`, and give up as soon as
            // the caret leaves it or a space ends the command.
            const head = view.state.selection.head
            if (!view.state.selection.empty || head <= from) { close(); return }
            const typed = view.state.doc.textBetween(from, head, '\n', '\n')
            if (!typed.startsWith('/') || /\s/.test(typed)) { close(); return }
            const next = typed.slice(1)
            if (next !== filter) {
              filter = next
              publish(view, from)
            }
          },
          destroy() { close() },
        }
      },
    })
  })
}

