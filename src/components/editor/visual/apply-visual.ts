// Visual-mode backend for the markdown action catalog.
//
// Same MD_ACTIONS the ribbon and slash menu use in Source mode; only the way an
// action reaches the document differs. Here it becomes a ProseMirror command
// rather than a text edit, so the schema stays authoritative and undo works.

import { editorViewCtx, commandsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand,
  wrapInHeadingCommand, wrapInBulletListCommand, wrapInOrderedListCommand,
  wrapInBlockquoteCommand, insertHardbreakCommand, turnIntoTextCommand,
  createCodeBlockCommand, insertImageCommand,
} from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand, insertTableCommand } from '@milkdown/kit/preset/gfm'
import type { MdActionDef } from '@/lib/markdown/actions'
import { nextChunkLabel } from '@/lib/markdown/actions'

/**
 * Apply an action inside Milkdown.
 *
 * Returns false when the action has no Visual equivalent, so the caller can say
 * so rather than appearing to do nothing.
 */
export function applyVisualAction(ctx: Ctx, action: MdActionDef, docText: string): boolean {
  const commands = ctx.get(commandsCtx)
  const call = (cmd: Parameters<typeof commands.call>[0], payload?: unknown): boolean => {
    commands.call(cmd, payload)
    return true
  }

  switch (action.id) {
    case 'h1': return call(wrapInHeadingCommand.key, 1)
    case 'h2': return call(wrapInHeadingCommand.key, 2)
    case 'h3': return call(wrapInHeadingCommand.key, 3)
    case 'bold': return call(toggleStrongCommand.key)
    case 'italic': return call(toggleEmphasisCommand.key)
    case 'strike': return call(toggleStrikethroughCommand.key)
    case 'code': return call(toggleInlineCodeCommand.key)
    case 'ul': return call(wrapInBulletListCommand.key)
    case 'ol': return call(wrapInOrderedListCommand.key)
    case 'quote': return call(wrapInBlockquoteCommand.key)
    case 'codeblock': return call(createCodeBlockCommand.key, '')
    case 'image': return call(insertImageCommand.key, { src: '' })
    case 'table': return call(insertTableCommand.key)
    case 'hr': return insertNodeByName(ctx, 'hr')
    case 'task': return call(wrapInBulletListCommand.key)

    // Chunks are code blocks whose info string is the knitr header. Creating
    // them through the code-block command keeps the label auto-generation that
    // gives each chunk a stable identity.
    case 'rchunk':
    case 'chunk-plot':
    case 'chunk-map':
      return call(createCodeBlockCommand.key, `{r ${nextChunkLabel(docText)}}`)

    // Link and footnote need a URL/definition the command API can't prompt for;
    // Source mode handles them properly, so say so instead of half-doing it.
    case 'link':
    case 'footnote':
      return false

    default:
      return false
  }
}

/** Insert a bare node (used for the thematic break). */
function insertNodeByName(ctx: Ctx, name: string): boolean {
  try {
    const view = ctx.get(editorViewCtx)
    const type = view.state.schema.nodes[name]
    if (!type) return false
    view.dispatch(view.state.tr.replaceSelectionWith(type.create()))
    return true
  } catch {
    return false
  }
}

/** Actions with no Visual equivalent — the ribbon disables these in Visual mode. */
export const VISUAL_UNSUPPORTED = new Set(['link', 'footnote'])

export { insertHardbreakCommand, turnIntoTextCommand }
