import React from 'react'
import { cn } from '@/lib/utils'

/**
 * An on/off preference, as a switch rather than a checkbox.
 *
 * The distinction is not decoration. A checkbox states a value that something
 * else will later act on — the ticks in the Add Features list, "don't show this
 * again" in a dialog you are about to dismiss. A switch takes effect the moment
 * it moves, and every setting in the Settings dialog is that: there is no OK
 * button to press afterwards. Checkboxes elsewhere in the app are staying
 * checkboxes for exactly that reason.
 *
 * **The whole row is the control.** A `<button>` nested inside a `<label>` is
 * two click targets that both fire, and a switch beside a label that is not
 * itself clickable is a smaller thing to hit than it looks. So the row IS the
 * button: one target, keyboard-operable for free, and `data-ourgeo-id` lands on
 * something `HighlightOverlay` can ring in a way the user will recognise.
 *
 * Pass the highlight attribute at the CALL SITE as a literal: `registry.test.ts`
 * scans component source for that attribute and cannot see one built from a
 * prop. (Written without its quoted form here, because that same scan would
 * read the example in this comment as a real target and fail to find it in
 * `targets.ts`.)
 */
export interface SwitchProps
  extends Omit<React.ComponentPropsWithoutRef<'button'>, 'onChange' | 'children' | 'type'> {
  checked: boolean
  onChange: (next: boolean) => void
  label: React.ReactNode
  /** The line under the label — what turning it off actually costs. */
  description?: React.ReactNode
}

export function Switch({
  checked, onChange, label, description, disabled, className, ...rest
}: SwitchProps): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'group flex w-full items-start gap-3 text-left rounded',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-geo-accent',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        className,
      )}
      {...rest}
    >
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-xs text-foreground">{label}</span>
        {description && (
          <span className="text-[10px] text-geo-muted leading-relaxed">{description}</span>
        )}
      </span>
      {/* aria-hidden: the button itself carries the state, so the track is a
          picture of it and must not be announced a second time. */}
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex-shrink-0 h-4 w-7 rounded-full border transition-colors',
          checked
            ? 'bg-geo-accent border-geo-accent'
            : 'bg-geo-bg border-geo-border group-hover:border-geo-muted',
        )}
      >
        {/* The knob dims when off. Position alone reads as "on" at a glance
            when the knob is full-strength in both states — the eye takes a
            bright dot for a lit one — and `muted` against `foreground` is the
            contrast pair every theme already defines. */}
        <span
          className={cn(
            'block h-3 w-3 mt-[1.5px] rounded-full transition-all',
            checked
              ? 'translate-x-[13px] bg-foreground'
              : 'translate-x-[2px] bg-geo-muted group-hover:bg-foreground',
          )}
        />
      </span>
    </button>
  )
}
