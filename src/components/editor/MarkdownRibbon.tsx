import React, { useMemo } from 'react'
import { RibbonButton, RibbonDivider, RibbonShell } from '../ui/ribbon'
import {
  actionsFor, RIBBON_GROUPS,
  type MdActionDef,
} from '@/lib/markdown/actions'

export interface MarkdownRibbonBackend {
  /** Apply an action to the document. */
  apply(action: MdActionDef): void
  /** Current buffer text — used to pick the next free chunk label. */
  getText(): string
}

interface Props {
  /** .Rmd documents get the chunk actions; plain .md does not. */
  supportsChunks: boolean
  backend: MarkdownRibbonBackend
  /** Visual mode: a few actions have no ProseMirror equivalent. */
  unsupported?: ReadonlySet<string>
}

/**
 * Insert buttons for markdown documents, mounted below the editor.
 *
 * Everything here is driven by MD_ACTIONS; the ribbon itself holds no per-action
 * logic, so the same catalog can feed the slash menu and (later) Visual mode.
 */
export function MarkdownRibbon({
  supportsChunks, backend, unsupported,
}: Props): React.ReactElement {
  const groups = useMemo(() => {
    const available = actionsFor(supportsChunks)
    return RIBBON_GROUPS
      .map((g) => ({ group: g, actions: available.filter((a) => a.group === g) }))
      .filter((g) => g.actions.length > 0)
  }, [supportsChunks])

  return (
    <RibbonShell>
      {groups.map(({ group, actions }, i) => (
        <React.Fragment key={group}>
          {i > 0 && <RibbonDivider />}
          {actions.map((action) => (
            <ActionButton
              key={action.id}
              action={action}
              backend={backend}
              disabled={unsupported?.has(action.id) ?? false}
            />
          ))}
        </React.Fragment>
      ))}
    </RibbonShell>
  )
}

function ActionButton({
  action, backend, disabled,
}: {
  action: MdActionDef
  backend: MarkdownRibbonBackend
  disabled: boolean
}): React.ReactElement {
  const Icon = action.icon
  const base = action.note ? `${action.label} — ${action.note}` : action.label
  const title = disabled ? `${action.label} — Source mode only` : base
  // Icon-only for the dense groups; the ouRGeo chunk actions carry a label
  // because their icons alone wouldn't say what they insert.
  const labelled = action.group === 'ourgeo'
  return (
    <RibbonButton
      title={title}
      disabled={disabled}
      onClick={() => { if (!disabled) backend.apply(action) }}
    >
      <Icon className="w-3 h-3" />
      {labelled && <span>{action.label.replace(/^Chunk: /, '')}</span>}
    </RibbonButton>
  )
}
