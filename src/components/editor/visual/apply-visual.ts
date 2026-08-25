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
  createCodeBlockCommand, insertImageCommand, toggleLinkCommand,
} from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand, insertTableCommand } from '@milkdown/kit/preset/gfm'
import { Fragment, Slice } from '@milkdown/kit/prose/model'
import type { MdActionDef } from '@/lib/markdown/actions'
import { nextChunkLabel } from '@/lib/markdown/actions'
import { buildMapChunkParts, chunkVariantFor } from '@/lib/markdown/chunk-codegen'

/**
 * Apply an action inside Milkdown.
 *
 * Returns false when the action has no Visual equivalent, so the caller can say
 * so rather than appearing to do nothing.
 *
 * `values` carries whatever the action's prompt dialog collected (a link's URL);
 * it is absent for the actions that need nothing.
 */
export function applyVisualAction(
  ctx: Ctx, action: MdActionDef, docText: string, values?: Record<string, string>,
): boolean {
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

    case 'link': return insertLink(ctx, values)

    case 'rchunk':
    case 'chunk-plot':
    case 'chunk-map':
      return insertChunk(ctx, action, docText)

    // Footnotes have no node in Milkdown's commonmark/gfm schema, so there is
    // nothing here to insert into — Source mode owns them. The Visual round-trip
    // guard warns before entering a document that already has some.
    case 'footnote':
      return false

    default:
      return false
  }
}

/**
 * Link, with the URL the prompt dialog collected.
 *
 * With a selection, toggle the mark so the user's own text and any formatting
 * inside it survive. With none, insert the text carrying the mark — there is no
 * command for that, because there is nothing to toggle onto yet.
 */
function insertLink(ctx: Ctx, values?: Record<string, string>): boolean {
  const href = values?.url?.trim()
  if (!href) return false
  const view = ctx.get(editorViewCtx)
  const { state } = view

  if (!state.selection.empty) {
    ctx.get(commandsCtx).call(toggleLinkCommand.key, { href })
    return true
  }

  const markType = state.schema.marks.link
  if (!markType) return false
  const text = values?.text?.trim() || href
  const node = state.schema.text(text, [markType.create({ href })])
  view.dispatch(state.tr.replaceSelectionWith(node, false).scrollIntoView())
  return true
}

/**
 * Insert a chunk as a real code_block, so it keeps its `{r label, …}` header.
 *
 * The two ouRGeo chunk actions fill the body from the live map, the same
 * generated code Source mode inserts — this is why chunk-codegen returns the
 * header and code separately rather than a string of fences.
 */
function insertChunk(ctx: Ctx, action: MdActionDef, docText: string): boolean {
  const label = nextChunkLabel(docText)
  const saveFigure = chunkVariantFor(action)
  const parts = saveFigure === null ? null : buildMapChunkParts({ label, saveFigure })

  const header = parts?.header ?? `r ${label}`
  const code = parts?.code ?? ''
  const view = ctx.get(editorViewCtx)
  const { state } = view
  const codeBlock = state.schema.nodes.code_block
  if (!codeBlock) return false

  // `language` holds the first info-string token and `meta` the rest, matching
  // how mdast splits a fence — see chunk-view.ts.
  const space = header.indexOf(' ')
  const language = space < 0 ? `{${header}}` : `{${header.slice(0, space)}`
  const meta = space < 0 ? '' : `${header.slice(space + 1)}}`

  const nodes = [
    codeBlock.create({ language, meta }, code ? state.schema.text(code) : null),
  ]
  if (parts?.after) {
    const image = state.schema.nodes.image
    const paragraph = state.schema.nodes.paragraph
    const src = /\((.*)\)\s*$/.exec(parts.after)?.[1]
    if (image && paragraph && src) {
      nodes.push(paragraph.create(null, image.create({ src, alt: '' })))
    }
  }

  view.dispatch(
    state.tr.replaceSelection(new Slice(Fragment.from(nodes), 0, 0)).scrollIntoView()
  )
  return true
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

/** Actions with no Visual equivalent — the ribbon dims these in Visual mode. */
export const VISUAL_UNSUPPORTED = new Set(['footnote'])

export { insertHardbreakCommand, turnIntoTextCommand }
