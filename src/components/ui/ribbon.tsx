import React from 'react'

// Shared bottom-ribbon primitives. Extracted from GeometryEditRibbon when the
// markdown ribbon became a second consumer — a third copy of the same button
// styling was the wrong answer.

export function RibbonButton({
  active,
  disabled,
  danger,
  accent,
  title,
  onClick,
  children,
  // Ribbon buttons are things the assistant points at (`ui:highlight` finds a
  // control by this attribute), so the shared primitive has to be able to
  // carry one.
  'data-ourgeo-id': ourgeoId
}: {
  active?: boolean
  disabled?: boolean
  danger?: boolean
  accent?: boolean
  title?: string
  onClick: () => void
  children: React.ReactNode
  'data-ourgeo-id'?: string
}): React.ReactElement {
  const base = 'px-2 py-1 text-xs rounded border flex items-center gap-1 flex-shrink-0 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed'
  const cls = active
    ? 'bg-geo-accent/10 text-geo-accent border-geo-accent'
    : danger
      ? 'border-geo-error/50 text-geo-error hover:bg-geo-error/10'
      : accent
        ? 'border-geo-accent bg-geo-accent/10 text-geo-accent hover:bg-geo-accent/20'
        : 'border-geo-border text-foreground hover:bg-geo-bg'
  return (
    <button
      className={`${base} ${cls}`}
      disabled={disabled}
      title={title}
      data-ourgeo-id={ourgeoId}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export const RibbonDivider = (): React.ReactElement => (
  <div className="w-px h-5 bg-geo-border flex-shrink-0" />
)

/** The standard bottom-ribbon shell: fixed height, scrolls horizontally when
 *  the panel is narrow rather than wrapping or clipping. */
export function RibbonShell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="h-10 flex-shrink-0 flex items-center gap-2 px-3 bg-geo-panel border-t border-geo-border">
      <div className="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </div>
  )
}
