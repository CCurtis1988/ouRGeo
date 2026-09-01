import React, { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Image as ImageIcon, Trash2, Upload } from 'lucide-react'
import {
  base64Bytes, formatBytes, mimeForPath, normalizeHex,
  validateImageDataUri, type ImageSpec,
} from '@/lib/custom-themes'

// Controls for the Theme Studio. Small, uncontroversial, and gathered here
// because the three editors would otherwise each grow their own colour input
// and drift apart in the details that matter (what a bad hex does, whether the
// swatch or the text field is the source of truth).

export function Row({ label, hint, children }: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-foreground">{label}</div>
        {hint && <div className="text-[10px] text-geo-muted leading-snug mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Section({ title, hint, children }: {
  title: string
  hint?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="pt-4 first:pt-0">
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-geo-muted">
        {title}
      </h3>
      {hint && <p className="text-[10px] text-geo-muted leading-relaxed mt-1">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

/**
 * A colour swatch plus its hex.
 *
 * The text field is deliberately NOT controlled straight through `value`:
 * a user typing `#3a` would have every intermediate keystroke normalised out
 * from under them. It keeps its own draft, commits when the draft parses, and
 * snaps back to the committed colour on blur — so a half-typed hex is allowed
 * to exist and an abandoned one cannot survive as `#000000`.
 */
export function ColorField({ label, hint, value, onChange, warn }: {
  label: string
  hint?: string
  value: string
  onChange: (hex: string) => void
  /** Shown as a warning triangle with this as its tooltip. */
  warn?: string | null
}): React.ReactElement {
  const [draft, setDraft] = useState(value)
  const id = useId()
  useEffect(() => { setDraft(value) }, [value])

  const commit = (raw: string): void => {
    const hex = normalizeHex(raw)
    if (hex) onChange(hex)
  }

  return (
    <div className="flex items-center gap-2 py-[3px]">
      <label
        htmlFor={id}
        className="flex-1 min-w-0 text-[11px] text-foreground cursor-pointer truncate"
        title={hint}
      >
        {label}
      </label>
      {warn && (
        <span title={warn} className="text-geo-warning shrink-0">
          <AlertTriangle className="w-3 h-3" />
        </span>
      )}
      <input
        value={draft}
        onChange={(e) => { setDraft(e.target.value); commit(e.target.value) }}
        onBlur={() => setDraft(value)}
        spellCheck={false}
        aria-label={`${label} hex value`}
        className="w-[74px] bg-geo-bg border border-geo-border rounded px-1.5 py-0.5
          text-[11px] font-mono text-foreground outline-none focus:border-geo-accent"
      />
      <input
        id={id}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-7 h-6 rounded cursor-pointer border border-geo-border bg-transparent shrink-0"
      />
    </div>
  )
}

export function TextField({ label, value, onChange, placeholder, maxLength }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  maxLength?: number
}): React.ReactElement {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-geo-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs
          text-foreground outline-none focus:border-geo-accent"
      />
    </label>
  )
}

export function SelectField({ label, hint, value, onChange, children }: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}): React.ReactElement {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-geo-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs
          text-foreground outline-none focus:border-geo-accent"
      >
        {children}
      </select>
      {hint && <span className="text-[10px] text-geo-muted leading-snug">{hint}</span>}
    </label>
  )
}

export function SliderField({ label, value, min, max, step, format, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format?: (v: number) => string
  onChange: (v: number) => void
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[11px] text-foreground flex-1 min-w-0 truncate">{label}</span>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-32 accent-geo-accent"
      />
      <span className="text-[10px] font-mono text-geo-muted w-9 text-right">
        {format ? format(value) : value}
      </span>
    </div>
  )
}

export function CheckField({ label, checked, onChange }: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): React.ReactElement {
  return (
    <label className="flex items-center gap-2 py-1 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-geo-accent"
      />
      <span className="text-[11px] text-foreground">{label}</span>
    </label>
  )
}

/**
 * Pick an image file and inline it as a `data:` URI.
 *
 * Inlining rather than storing a path is what makes a theme portable: an
 * exported `.ourgeotheme.json` has to carry its own artwork or it arrives on
 * someone else's machine pointing at a file that isn't there. The cost is the
 * size cap in `spec`, which is enforced here, on the way in, where the user
 * can still choose a different picture.
 */
export function ImageField({ label, spec, value, onChange, aspect = '16 / 9' }: {
  label: string
  spec: ImageSpec
  value: string | null
  onChange: (uri: string | null) => void
  aspect?: string
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const choose = async (): Promise<void> => {
    setError(null)
    const path = await window.electronAPI.dialog.openThemeImage(`Choose ${label}`)
    if (!path) return
    const mime = mimeForPath(path)
    if (!mime) {
      setError(`ouRGeo cannot read that file type. Use ${spec.formats.join(', ')}.`)
      return
    }
    setBusy(true)
    try {
      const b64 = await window.electronAPI.file.readBinary(path)
      const uri = `data:${mime};base64,${b64}`
      const check = validateImageDataUri(uri, spec)
      if (!alive.current) return
      if (!check.ok) setError(check.error)
      else { onChange(check.uri); setError(null) }
    } catch {
      if (alive.current) setError('That image could not be read.')
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-3">
        <div
          className="w-28 shrink-0 rounded border border-geo-border overflow-hidden
            bg-geo-bg flex items-center justify-center"
          style={{ aspectRatio: aspect }}
        >
          {value
            ? <img src={value} alt="" draggable={false} className="w-full h-full object-cover" />
            : <ImageIcon className="w-4 h-4 text-geo-muted" />}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { void choose() }}
              disabled={busy}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded
                border border-geo-border text-foreground hover:border-geo-accent
                hover:text-geo-accent transition-colors disabled:opacity-50"
            >
              <Upload className="w-3 h-3" />
              {busy ? 'Reading…' : value ? 'Replace…' : 'Choose image…'}
            </button>
            {value && (
              <button
                onClick={() => { onChange(null); setError(null) }}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded
                  border border-geo-border text-geo-muted hover:text-geo-error
                  hover:border-geo-error transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Remove
              </button>
            )}
            {value && (
              <span className="text-[10px] text-geo-muted font-mono">
                {formatBytes(base64Bytes(value))}
              </span>
            )}
          </div>
          <p className="text-[10px] text-geo-muted leading-relaxed">{spec.guidance}</p>
        </div>
      </div>
      {error && (
        <p className="text-[10px] text-geo-error leading-snug flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}
