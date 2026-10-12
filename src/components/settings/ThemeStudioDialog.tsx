import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  AlertTriangle, Check, CheckCircle2, Copy, Download, Lock, Plus,
  Trash2, Upload, X,
} from 'lucide-react'
import { THEMES, BUILTIN_THEME_LIST, type ThemeDef } from '@/lib/themes'
import {
  CODE_THEMES, MARKDOWN_THEMES, CODE_THEME_LIST, MARKDOWN_THEME_LIST,
  resolveCodeTheme, resolveMarkdownTheme,
  type SyntaxPalette, type MarkdownPalette,
} from '@/lib/editor-themes'
import {
  KIND_LABEL, TAB_LABEL, systemColorsFromDef,
  type CustomSystemTheme, type CustomCodeTheme, type CustomMarkdownTheme,
  type ThemeKind,
} from '@/lib/custom-themes'
import { themeIconUri } from '@/lib/themeScenes'
import {
  useCustomThemeStore, exportThemes, importThemesFromFile,
} from '@/store/custom-themes'
import { useThemeStore } from '@/store/theme'
import { SystemThemeEditor } from './theme-studio/SystemThemeEditor'
import { CodeThemeEditor, MarkdownThemeEditor } from './theme-studio/PaletteEditor'
import { ThemePreview, type PreviewInput } from './theme-studio/ThemePreview'

// The Theme Studio.
//
// One dialog for all three axes, because they are the same task with different
// fields and because the interesting relationships run BETWEEN them: an app
// theme names the code and markdown palettes it starts with, and a palette is
// only legible against some app theme's editor surface. Three separate dialogs
// would have had to explain that in prose.
//
// Two rules shape the whole thing:
//
//  * **Shipped themes are read-only.** Selecting one shows it and offers
//    "Duplicate to edit". Editing in place would mean an ouRGeo update could
//    silently revert a user's work, and it would make "reset to default"
//    impossible to offer honestly.
//
//  * **Edits commit on a debounce, previews are instant.** The preview pane is
//    drawn from the draft with inline styles and updates on every keystroke;
//    the application itself is updated once the user pauses. See the note on
//    Monaco's `defineTheme` effect in `CodeEditor` for why a commit per drag
//    of a colour picker would be a real problem rather than a stylistic one.

const COMMIT_DELAY_MS = 250

const KINDS: ThemeKind[] = ['system', 'code', 'markdown']

interface Notice { tone: 'ok' | 'error'; text: string }

/** A row in the sidebar. */
function ThemeRow({ label, badge, selected, active, locked, swatches, icon, onClick }: {
  label: string
  badge?: string
  selected: boolean
  active: boolean
  locked: boolean
  swatches: string[]
  icon?: string
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${
        selected
          ? 'bg-geo-accent/15 text-foreground ring-1 ring-geo-accent/50'
          : 'text-geo-muted hover:bg-geo-bg hover:text-foreground'
      }`}
    >
      {icon
        ? <img src={icon} alt="" draggable={false} className="w-8 h-[18px] rounded-sm object-cover shrink-0" />
        : (
          <span className="flex shrink-0 rounded-sm overflow-hidden w-8 h-[18px] border border-geo-border">
            {swatches.map((c, i) => (
              <span key={i} className="flex-1" style={{ background: c }} />
            ))}
          </span>
        )}
      <span className="flex-1 min-w-0 truncate text-[11px]">{label}</span>
      {active && (
        <span title="In use" className="shrink-0 text-geo-success">
          <Check className="w-3 h-3" />
        </span>
      )}
      {locked && (
        <span title="Shipped with ouRGeo — duplicate it to edit" className="shrink-0">
          <Lock className="w-3 h-3" />
        </span>
      )}
      {badge && (
        <span className="shrink-0 text-[9px] border border-geo-border rounded px-1">
          {badge}
        </span>
      )}
    </button>
  )
}

/** The "New theme" form. Inline rather than a nested dialog: it is two fields,
 *  and a modal over a modal to name a thing is a lot of ceremony. */
function NewThemeForm({ kind, onCreate, onCancel }: {
  kind: ThemeKind
  onCreate: (templateId: string, label: string) => void
  onCancel: () => void
}): React.ReactElement {
  const custom = useCustomThemeStore()
  const templates = useMemo(() => {
    if (kind === 'system') {
      return [
        ...BUILTIN_THEME_LIST.map((t) => ({ id: t.id, label: t.label, mine: false })),
        ...custom.system.map((t) => ({ id: t.id, label: t.label, mine: true })),
      ]
    }
    if (kind === 'code') {
      return [
        ...CODE_THEME_LIST.map((t) => ({ id: t.id, label: t.label, mine: false })),
        ...custom.code.map((t) => ({ id: t.id, label: t.label, mine: true })),
      ]
    }
    return [
      ...MARKDOWN_THEME_LIST.map((t) => ({ id: t.id, label: t.label, mine: false })),
      ...custom.markdown.map((t) => ({ id: t.id, label: t.label, mine: true })),
    ]
  }, [kind, custom.system, custom.code, custom.markdown])

  const active = useThemeStore((s) =>
    kind === 'system' ? s.current : kind === 'code' ? s.codeTheme : s.markdownTheme)
  const [template, setTemplate] = useState(
    () => (templates.some((t) => t.id === active) ? active : templates[0]?.id ?? 'dark'))
  const [label, setLabel] = useState('')

  const chosen = templates.find((t) => t.id === template)
  const name = label.trim() || `${chosen?.label ?? 'New'} (copy)`

  return (
    <div className="rounded border border-geo-accent/40 bg-geo-bg p-2 flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-wider text-geo-muted">
        New {KIND_LABEL[kind].toLowerCase()}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-geo-muted">Start from</span>
        <select
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          className="bg-geo-panel border border-geo-border rounded px-1.5 py-1
            text-[11px] text-foreground outline-none focus:border-geo-accent"
        >
          <optgroup label="Built in">
            {templates.filter((t) => !t.mine).map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </optgroup>
          {templates.some((t) => t.mine) && (
            <optgroup label="Yours">
              {templates.filter((t) => t.mine).map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-geo-muted">Name</span>
        <input
          autoFocus
          value={label}
          maxLength={40}
          placeholder={name}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCreate(template, name)
            if (e.key === 'Escape') onCancel()
          }}
          className="bg-geo-panel border border-geo-border rounded px-1.5 py-1
            text-[11px] text-foreground outline-none focus:border-geo-accent"
        />
      </label>
      <div className="flex gap-1.5">
        <button
          onClick={() => onCreate(template, name)}
          className="flex-1 text-[11px] px-2 py-1 rounded bg-geo-accent text-white
            hover:bg-geo-accent-hover transition-colors"
        >
          Create
        </button>
        <button
          onClick={onCancel}
          className="text-[11px] px-2 py-1 rounded border border-geo-border
            text-geo-muted hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
      <p className="text-[10px] text-geo-muted leading-snug">
        A copy of {chosen?.label ?? 'the template'} you can change freely. The
        original stays exactly as it is.
      </p>
    </div>
  )
}

export function ThemeStudioDialog({ open, onOpenChange }: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const custom = useCustomThemeStore()
  // Individual selectors, not the whole store: the preview memo depends on
  // these three ids and a store object would be a new reference every render.
  const activeSystem = useThemeStore((s) => s.current)
  const activeCode = useThemeStore((s) => s.codeTheme)
  const activeMarkdown = useThemeStore((s) => s.markdownTheme)

  const [kind, setKind] = useState<ThemeKind>('system')
  const [selected, setSelected] = useState<Record<ThemeKind, string | null>>({
    system: null, code: null, markdown: null,
  })
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const selectedId = selected[kind]
  const select = (id: string | null): void =>
    setSelected((s) => ({ ...s, [kind]: id }))

  // ── The draft, and the debounced commit ────────────────────────────────
  // `draft` is the only thing the form writes to. A timer pushes it into the
  // store, which is what installs it into the registries and repaints the app.
  const [draft, setDraft] = useState<
    CustomSystemTheme | CustomCodeTheme | CustomMarkdownTheme | null
  >(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<{ kind: ThemeKind; theme: unknown } | null>(null)

  const flush = useCallback((): void => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const p = pending.current
    pending.current = null
    if (!p) return
    const store = useCustomThemeStore.getState()
    if (p.kind === 'system') store.saveSystem(p.theme as CustomSystemTheme)
    else if (p.kind === 'code') store.saveCode(p.theme as CustomCodeTheme)
    else store.saveMarkdown(p.theme as CustomMarkdownTheme)
  }, [])

  // Any pending edit must land before the studio goes away, or the last thing
  // the user typed is the one thing that does not get saved.
  useEffect(() => () => flush(), [flush])
  useEffect(() => { if (!open) flush() }, [open, flush])

  const schedule = useCallback((k: ThemeKind, theme: unknown): void => {
    pending.current = { kind: k, theme }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      const p = pending.current
      pending.current = null
      if (!p) return
      const store = useCustomThemeStore.getState()
      if (p.kind === 'system') store.saveSystem(p.theme as CustomSystemTheme)
      else if (p.kind === 'code') store.saveCode(p.theme as CustomCodeTheme)
      else store.saveMarkdown(p.theme as CustomMarkdownTheme)
    }, COMMIT_DELAY_MS)
  }, [])

  // Load the selection into the draft. Flushing first is what keeps an edit
  // from being carried onto the theme the user just clicked.
  useEffect(() => {
    flush()
    if (!selectedId) { setDraft(null); return }
    const s = useCustomThemeStore.getState()
    const found: CustomSystemTheme | CustomCodeTheme | CustomMarkdownTheme | undefined =
      kind === 'system' ? s.system.find((t) => t.id === selectedId)
      : kind === 'code' ? s.code.find((t) => t.id === selectedId)
      : s.markdown.find((t) => t.id === selectedId)
    setDraft(found ? { ...found } : null)
    setConfirmDelete(null)
    // Re-run on the id and axis only: re-running on the store's arrays would
    // clobber the draft with the value the debounce just wrote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, selectedId])

  const patch = (p: Record<string, unknown>): void => {
    setDraft((d) => {
      if (!d) return d
      const next = { ...d, ...p } as CustomSystemTheme | CustomCodeTheme | CustomMarkdownTheme
      schedule(kind, next)
      return next
    })
  }

  // ── Lists ──────────────────────────────────────────────────────────────
  const mine: Array<{ id: string; label: string; swatches: string[]; icon?: string; legacy?: true }> =
    useMemo(() => {
      if (kind === 'system') {
        return custom.system.map((t) => ({
          id: t.id, label: t.label,
          swatches: [t.colors.bg, t.colors.accent, t.colors.fg],
          icon: t.iconImage ?? t.backgroundImage ?? undefined,
        }))
      }
      if (kind === 'code') {
        return custom.code.map((t) => ({
          id: t.id, label: t.label, swatches: [t.keyword, t.string, t.fn],
        }))
      }
      return custom.markdown.map((t) => ({
        id: t.id, label: t.label, swatches: [t.heading, t.link, t.code],
      }))
    }, [kind, custom.system, custom.code, custom.markdown])

  const builtin: Array<{ id: string; label: string; swatches: string[]; icon?: string; legacy?: true }> =
    useMemo(() => {
      if (kind === 'system') {
        return BUILTIN_THEME_LIST.map((t) => ({
          id: t.id, label: t.label, swatches: t.swatches, icon: themeIconUri(t.id), legacy: t.legacy,
        }))
      }
      if (kind === 'code') {
        return CODE_THEME_LIST.map((t) => ({
          id: t.id, label: t.label, swatches: [t.keyword, t.string, t.fn],
        }))
      }
      return MARKDOWN_THEME_LIST.map((t) => ({
        id: t.id, label: t.label, swatches: [t.heading, t.link, t.code],
      }))
    }, [kind])

  const activeId =
    kind === 'system' ? activeSystem
    : kind === 'code' ? activeCode : activeMarkdown

  const isMine = mine.some((t) => t.id === selectedId)

  // ── Preview ────────────────────────────────────────────────────────────
  // The app half comes from the draft in system mode and from the ACTIVE app
  // theme otherwise — a palette has no surface of its own, and inventing one
  // for the preview would show the user a combination they will never see.
  const preview: PreviewInput = useMemo(() => {
    const app: ThemeDef = THEMES[activeSystem] ?? THEMES.dark
    if (kind === 'system' && draft && 'colors' in draft) {
      const d = draft
      return {
        colors: d.colors,
        chrome: d.chrome,
        code: resolveCodeTheme(d.basedOn, d.defaultCodeTheme),
        markdown: resolveMarkdownTheme(d.basedOn, d.defaultMarkdownTheme),
        backdrop: d.backgroundImage,
        backdropOpacity: d.backgroundOpacity,
        backdropGrayscale: d.backgroundGrayscale,
      }
    }
    if (kind === 'system' && selectedId && THEMES[selectedId]) {
      const t = THEMES[selectedId]
      return {
        colors: systemColorsFromDef(t),
        chrome: t.editorChrome,
        code: resolveCodeTheme(t.id, t.defaultCodeTheme),
        markdown: resolveMarkdownTheme(t.id, t.defaultMarkdownTheme),
        backdrop: t.backgroundImage ?? null,
        backdropOpacity: t.backgroundOpacity ?? 0.15,
        backdropGrayscale: t.backgroundGrayscale ?? true,
      }
    }
    const code: SyntaxPalette =
      kind === 'code'
        ? (draft as SyntaxPalette | null)
          ?? CODE_THEMES[selectedId ?? ''] ?? resolveCodeTheme(app.id, activeCode)
        : resolveCodeTheme(app.id, activeCode)
    const md: MarkdownPalette =
      kind === 'markdown'
        ? (draft as MarkdownPalette | null)
          ?? MARKDOWN_THEMES[selectedId ?? ''] ?? resolveMarkdownTheme(app.id, activeMarkdown)
        : resolveMarkdownTheme(app.id, activeMarkdown)
    return {
      colors: systemColorsFromDef(app),
      chrome: app.editorChrome,
      code,
      markdown: md,
      backdrop: app.backgroundImage ?? null,
      backdropOpacity: app.backgroundOpacity ?? 0.15,
      backdropGrayscale: app.backgroundGrayscale ?? true,
    }
  }, [kind, draft, selectedId, activeSystem, activeCode, activeMarkdown])

  // ── Actions ────────────────────────────────────────────────────────────
  const use = (): void => {
    if (!selectedId) return
    flush()
    const theme = useThemeStore.getState()
    if (kind === 'system') theme.setTheme(selectedId)
    else if (kind === 'code') theme.setCodeTheme(selectedId)
    else theme.setMarkdownTheme(selectedId)
    setNotice({ tone: 'ok', text: 'Applied.' })
  }

  const doDuplicate = (): void => {
    if (!selectedId) return
    flush()
    const store = useCustomThemeStore.getState()
    const id = isMine
      ? store.duplicate(kind, selectedId)
      : store.createFrom(
          kind, selectedId,
          `${(kind === 'system' ? THEMES[selectedId]?.label
            : kind === 'code' ? CODE_THEMES[selectedId]?.label
            : MARKDOWN_THEMES[selectedId]?.label) ?? 'Theme'} (copy)`,
        )
    if (id) { select(id); setNotice({ tone: 'ok', text: 'Copy created — it is yours to edit.' }) }
  }

  const doExport = async (): Promise<void> => {
    if (!selectedId || !isMine) return
    flush()
    const s = useCustomThemeStore.getState()
    const theme =
      kind === 'system' ? s.system.find((t) => t.id === selectedId)
      : kind === 'code' ? s.code.find((t) => t.id === selectedId)
      : s.markdown.find((t) => t.id === selectedId)
    if (!theme) return
    try {
      const path = await exportThemes(kind, [theme], theme.label)
      if (path) setNotice({ tone: 'ok', text: `Exported to ${path}` })
    } catch {
      setNotice({ tone: 'error', text: 'That file could not be written.' })
    }
  }

  const doImport = async (): Promise<void> => {
    flush()
    setNotice(null)
    const res = await importThemesFromFile(kind)
    if (!res) return
    if (!res.ok) { setNotice({ tone: 'error', text: res.error }); return }
    setNotice({
      tone: 'ok',
      text: res.count === 1
        ? `Imported “${res.names[0]}”.`
        : `Imported ${res.count} themes.`,
    })
  }

  const doDelete = (): void => {
    if (!selectedId || !isMine) return
    if (confirmDelete !== selectedId) { setConfirmDelete(selectedId); return }
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    pending.current = null
    useCustomThemeStore.getState().remove(kind, selectedId)
    setConfirmDelete(null)
    select(null)
  }

  const selectedLabel =
    kind === 'system' ? THEMES[selectedId ?? '']?.label
    : kind === 'code' ? CODE_THEMES[selectedId ?? '']?.label
    : MARKDOWN_THEMES[selectedId ?? '']?.label

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]
            w-[1180px] max-w-[95vw] h-[720px] max-h-[92vh] flex flex-col
            bg-geo-panel border border-geo-border rounded-lg shadow-2xl focus:outline-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-geo-border shrink-0">
            <div>
              <Dialog.Title className="text-sm font-semibold text-foreground">
                Theme Studio
              </Dialog.Title>
              <p className="text-[11px] text-geo-muted mt-0.5">
                Build your own themes, or start from one of ouRGeo&rsquo;s and change what you like.
              </p>
            </div>
            <Dialog.Close className="text-geo-muted hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 px-4 pt-2 shrink-0 border-b border-geo-border">
            {KINDS.map((k) => (
              <button
                key={k}
                onClick={() => { flush(); setKind(k); setCreating(false); setNotice(null) }}
                className={`text-xs px-3 py-1.5 rounded-t border-b-2 transition-colors ${
                  kind === k
                    ? 'border-geo-accent text-foreground'
                    : 'border-transparent text-geo-muted hover:text-foreground'
                }`}
              >
                {TAB_LABEL[k]}
              </button>
            ))}
          </div>

          {notice && (
            <div
              className={`mx-4 mt-2 shrink-0 flex items-start gap-2 rounded border px-2.5 py-1.5 text-[11px] leading-snug ${
                notice.tone === 'ok'
                  ? 'border-geo-success/40 text-geo-success bg-geo-success/10'
                  : 'border-geo-error/40 text-geo-error bg-geo-error/10'
              }`}
              role="status"
            >
              {notice.tone === 'ok'
                ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px" />
                : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />}
              <span className="flex-1 break-words">{notice.text}</span>
              <button
                onClick={() => setNotice(null)}
                className="shrink-0 opacity-70 hover:opacity-100"
                aria-label="Dismiss"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Body */}
          <div className="flex-1 min-h-0 flex">
            {/* Sidebar */}
            <div className="w-[196px] shrink-0 border-r border-geo-border flex flex-col">
              <div className="p-2 flex gap-1.5 shrink-0">
                <button
                  onClick={() => { setCreating((v) => !v); setNotice(null) }}
                  className="flex-1 inline-flex items-center justify-center gap-1 text-[11px]
                    px-2 py-1 rounded bg-geo-accent text-white hover:bg-geo-accent-hover
                    transition-colors"
                >
                  <Plus className="w-3 h-3" /> New
                </button>
                <button
                  onClick={() => { void doImport() }}
                  title={`Import a ${KIND_LABEL[kind].toLowerCase()} file`}
                  className="inline-flex items-center justify-center gap-1 text-[11px]
                    px-2 py-1 rounded border border-geo-border text-geo-muted
                    hover:text-foreground hover:border-geo-muted transition-colors"
                >
                  <Upload className="w-3 h-3" /> Import
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-2">
                {creating && (
                  <NewThemeForm
                    kind={kind}
                    onCancel={() => setCreating(false)}
                    onCreate={(templateId, label) => {
                      const id = useCustomThemeStore.getState().createFrom(kind, templateId, label)
                      setCreating(false)
                      select(id)
                      setNotice(null)
                    }}
                  />
                )}

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-geo-muted px-2 py-1">
                    Your themes
                  </div>
                  {mine.length === 0 ? (
                    <p className="text-[10px] text-geo-muted px-2 pb-1 leading-snug">
                      None yet. “New” copies an existing theme so you always start
                      from something that already works.
                    </p>
                  ) : mine.map((t) => (
                    <ThemeRow
                      key={t.id}
                      label={t.label}
                      selected={selectedId === t.id}
                      active={activeId === t.id}
                      locked={false}
                      swatches={t.swatches}
                      icon={t.icon}
                      onClick={() => { select(t.id); setNotice(null) }}
                    />
                  ))}
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-geo-muted px-2 py-1">
                    Built in
                  </div>
                  {builtin.filter(t => !t.legacy).map((t) => (
                    <ThemeRow
                      key={t.id}
                      label={t.label}
                      selected={selectedId === t.id}
                      active={activeId === t.id}
                      locked
                      swatches={t.swatches}
                      icon={t.icon}
                      onClick={() => { select(t.id); setNotice(null) }}
                    />
                  ))}
                </div>
                {kind === 'system' && (
                  <details className="border-t border-geo-border pt-2">
                    <summary className="cursor-pointer text-xs text-geo-muted px-2 py-1">Legacy themes</summary>
                    {builtin.filter(t => t.legacy).map(t => (
                      <ThemeRow key={t.id} label={t.label} selected={selectedId === t.id}
                        active={activeId === t.id} locked swatches={t.swatches} icon={t.icon}
                        onClick={() => { select(t.id); setNotice(null) }} />
                    ))}
                  </details>
                )}
              </div>
            </div>

            {/* Editor + preview */}
            <div className="flex-1 min-w-0 flex flex-col">
              {!selectedId ? (
                <div className="flex-1 flex items-center justify-center p-8">
                  <p className="text-xs text-geo-muted text-center max-w-sm leading-relaxed">
                    Pick a theme on the left to look at it, or press{' '}
                    <span className="text-foreground">New</span> to make one.
                    ouRGeo&rsquo;s own themes can be previewed here but not changed —
                    duplicate one and the copy is yours.
                  </p>
                </div>
              ) : (
                <>
                  {/* Action bar */}
                  <div className="flex items-center gap-1.5 px-4 py-2 border-b border-geo-border shrink-0">
                    <span className="text-xs text-foreground truncate flex-1 min-w-0">
                      {isMine ? (draft as { label?: string } | null)?.label ?? selectedLabel : selectedLabel}
                      {!isMine && (
                        <span className="ml-2 text-[10px] text-geo-muted">
                          shipped with ouRGeo — read only
                        </span>
                      )}
                    </span>
                    <button
                      onClick={use}
                      disabled={activeId === selectedId}
                      className="text-[11px] px-2 py-1 rounded border border-geo-border
                        text-foreground hover:border-geo-accent hover:text-geo-accent
                        transition-colors disabled:opacity-40 disabled:hover:border-geo-border
                        disabled:hover:text-foreground"
                    >
                      {activeId === selectedId ? 'In use' : 'Use this theme'}
                    </button>
                    <button
                      onClick={doDuplicate}
                      title="Duplicate"
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded
                        border border-geo-border text-geo-muted hover:text-foreground
                        hover:border-geo-muted transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      {isMine ? 'Duplicate' : 'Duplicate to edit'}
                    </button>
                    {isMine && (
                      <>
                        <button
                          onClick={() => { void doExport() }}
                          title="Export to a .ourgeotheme.json file"
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded
                            border border-geo-border text-geo-muted hover:text-foreground
                            hover:border-geo-muted transition-colors"
                        >
                          <Download className="w-3 h-3" /> Export
                        </button>
                        <button
                          onClick={doDelete}
                          className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded
                            border transition-colors ${
                              confirmDelete === selectedId
                                ? 'border-geo-error bg-geo-error/15 text-geo-error'
                                : 'border-geo-border text-geo-muted hover:text-geo-error hover:border-geo-error'
                            }`}
                        >
                          <Trash2 className="w-3 h-3" />
                          {confirmDelete === selectedId ? 'Delete for good?' : 'Delete'}
                        </button>
                      </>
                    )}
                  </div>

                  <div className="flex-1 min-h-0 flex">
                    <div className="flex-1 min-w-0 overflow-y-auto px-4 py-3">
                      {isMine && draft ? (
                        kind === 'system'
                          ? <SystemThemeEditor
                              draft={draft as CustomSystemTheme}
                              onChange={patch as (p: Partial<CustomSystemTheme>) => void}
                            />
                          : kind === 'code'
                            ? <CodeThemeEditor
                                draft={draft as CustomCodeTheme}
                                onChange={patch as (p: Partial<CustomCodeTheme>) => void}
                              />
                            : <MarkdownThemeEditor
                                draft={draft as CustomMarkdownTheme}
                                onChange={patch as (p: Partial<CustomMarkdownTheme>) => void}
                              />
                      ) : (
                        <div className="text-xs text-geo-muted leading-relaxed space-y-2 pt-2">
                          <p>
                            <span className="text-foreground">{selectedLabel}</span> ships with
                            ouRGeo, so it cannot be edited — an update would overwrite your
                            changes, and there would be no honest way back to the original.
                          </p>
                          <p>
                            <span className="text-foreground">Duplicate to edit</span> makes a
                            copy under your own name with every colour already set to this
                            theme&rsquo;s. That is the intended starting point.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="w-[330px] shrink-0 border-l border-geo-border p-3 overflow-y-auto">
                      <div className="text-[10px] uppercase tracking-wider text-geo-muted mb-2">
                        Preview
                      </div>
                      <ThemePreview input={preview} />
                      <p className="text-[10px] text-geo-muted leading-relaxed mt-2">
                        {kind === 'system'
                          ? 'Drawn from this theme alone — it updates as you type and does not change the application until you press “Use this theme”.'
                          : `Drawn on ${(THEMES[activeSystem] ?? THEMES.dark).label}'s surfaces, because a palette carries token colours only and is always read against some app theme's background.`}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
