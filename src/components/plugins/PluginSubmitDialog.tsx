import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Loader2, AlertCircle, Upload, Save, CheckCircle2 } from 'lucide-react'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { cn } from '@/lib/utils'
import { buildDistFiles } from '@/lib/plugins/store-package'
import { loadedPlugins } from '@/lib/plugins/loader'
import { storeErrorMessage } from '@/lib/plugin-store/client'
import * as storeClient from '@/lib/plugin-store/client'
import type { StoreCategory } from '@/lib/plugin-store/types'
import { useSessionStore } from '@/store/session'
import { PluginScreenshots, type PluginScreenshotsHandle } from './PluginScreenshots'

// Publishing a plugin you wrote.
//
// The store can be submitted to from here or from ourgeo.dev, and this dialog
// is what makes those the same submission rather than two formats. Only ouRGeo
// can BUILD one — the website's CSP carries no `wasm-unsafe-eval`, so esbuild
// cannot run there — so the upload page accepts a file this produces.
//
// ── What actually goes up ──────────────────────────────────────────────────
//
// Two archives. The distributable is the manifest, one minified module and the
// R files R has to read; a user downloads that. The SOURCE archive is the
// folder as it stands, and only the author and a moderator can ever read it —
// enforced by a storage policy, not by this app.
//
// The panel says both of those in plain words before anything is uploaded,
// because an author is entitled to know exactly what they are handing over,
// and "your code is protected" without the detail would be a claim this cannot
// support.

interface Props {
  open: boolean
  pluginId: string | null
  onOpenChange: (open: boolean) => void
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'building' }
  | { kind: 'uploading' }
  /** The version is in; its screenshots are going up behind it. */
  | { kind: 'attaching' }
  | { kind: 'done'; versionId: string; screenshots: { uploaded: number; failed: number } }
  | { kind: 'error'; message: string }

export function PluginSubmitDialog({ open, pluginId, onOpenChange }: Props): React.ReactElement {
  const plugin = loadedPlugins().find((p) => p.manifest.id === pluginId)
  const addConsoleEntry = useSessionStore((s) => s.addConsoleEntry)

  const [categories, setCategories] = useState<StoreCategory[]>([])
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('other')
  const [tags, setTags] = useState('')
  const [homepage, setHomepage] = useState('')
  const [license, setLicense] = useState('')
  const [changelog, setChangelog] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [warnings, setWarnings] = useState<string[]>([])
  const [signedIn, setSignedIn] = useState(false)
  const [shotsBusy, setShotsBusy] = useState(false)
  const screenshots = useRef<PluginScreenshotsHandle>(null)

  useEffect(() => {
    if (!open) return
    setPhase({ kind: 'idle' })
    setWarnings([])
    setSummary(plugin?.manifest.description?.slice(0, 200) ?? '')
    setHomepage(plugin?.manifest.homepage ?? '')
    void storeClient.categories().then(setCategories).catch(() => { /* falls back to "other" */ })
    void storeClient.accountStatus()
      .then((s) => setSignedIn(s.signedIn || s.hasStoredToken))
      .catch(() => setSignedIn(false))
  }, [open, plugin?.manifest.description, plugin?.manifest.homepage])

  /**
   * Build both archives.
   *
   * Always run before an upload AND before a Save, so the file on disk and the
   * file uploaded are the same bytes — a submission built once and uploaded
   * twice is the only way those two paths could ever disagree.
   */
  const build = useCallback(async () => {
    if (!plugin) return null
    setPhase({ kind: 'building' })
    const dist = await buildDistFiles(plugin.manifest)
    if (!dist.ok || !dist.files) {
      setPhase({ kind: 'error', message: dist.error ?? 'The plugin did not build.' })
      return null
    }
    setWarnings(dist.warnings)
    const built = await window.electronAPI.plugins.packBuilt(plugin.manifest.id, dist.files)
    return { dist, built }
  }, [plugin])

  const submit = useCallback(async () => {
    if (!plugin) return
    const made = await build()
    if (!made) return

    setPhase({ kind: 'uploading' })
    try {
      const { versionId } = await window.electronAPI.store.submit({
        pluginId: plugin.manifest.id,
        built: made.built,
        manifest: { ...plugin.manifest, main: made.dist.files!['main.js'] ? 'main.js' : undefined },
        meta: {
          name: plugin.manifest.name,
          summary,
          description: description || undefined,
          category,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8),
          homepage: homepage || undefined,
          license: license || undefined,
          changelog: changelog || undefined,
        },
      })

      // Only now does a plugin row exist, which is what `plugin_media` needs to
      // reference — so screenshots picked before a first submission are uploaded
      // here rather than refused at the moment they were chosen.
      setPhase({ kind: 'attaching' })
      const shots = await screenshots.current?.flush() ?? { uploaded: 0, failed: 0 }
      await screenshots.current?.refresh()

      setPhase({ kind: 'done', versionId, screenshots: shots })
      addConsoleEntry('info',
        `Submitted "${plugin.manifest.name}" ${plugin.manifest.version} to the plugin store. ` +
        'A moderator will install and test it before it appears.')
      if (shots.uploaded) {
        addConsoleEntry('info',
          `Attached ${shots.uploaded} screenshot${shots.uploaded === 1 ? '' : 's'} ` +
          `to "${plugin.manifest.id}".`)
      }
      if (shots.failed) {
        addConsoleEntry('error',
          `${shots.failed} screenshot${shots.failed === 1 ? '' : 's'} did not upload. ` +
          'Reopen Publish to retry them — the submission itself went through.')
      }
    } catch (e) {
      setPhase({ kind: 'error', message: storeErrorMessage(e) })
    }
  }, [plugin, build, summary, description, category, tags, homepage, license, changelog, addConsoleEntry])

  /** The other door: a file the website's upload page accepts. */
  const saveFile = useCallback(async () => {
    if (!plugin) return
    const made = await build()
    if (!made) return
    const out = await window.electronAPI.dialog.saveExportFile(
      `${plugin.manifest.id}-${plugin.manifest.version}.ourgeosubmit`)
    if (!out) { setPhase({ kind: 'idle' }); return }
    try {
      await window.electronAPI.plugins.saveSubmission(plugin.manifest.id, {
        slug: plugin.manifest.id,
        version: plugin.manifest.version,
        name: plugin.manifest.name,
        summary, description, category, homepage, license, changelog,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8),
        sha256: made.built.sha256,
      }, out)
      setPhase({ kind: 'idle' })
      addConsoleEntry('info', `Wrote ${out} — upload it at ourgeo.dev/plugins-submit.html.`)
    } catch (e) {
      setPhase({ kind: 'error', message: storeErrorMessage(e) })
    }
  }, [plugin, build, summary, description, category, tags, homepage, license, changelog, addConsoleEntry])

  const busy = phase.kind === 'building' || phase.kind === 'uploading' || phase.kind === 'attaching'
  // Screenshots in flight block Submit, because an upload interrupted by the
  // dialog closing is exactly the half-done state this panel exists to prevent.
  const canSubmit = Boolean(plugin) && summary.trim().length > 0 && signedIn && !busy && !shotsBusy

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
            w-[620px] max-w-[95vw] max-h-[85vh] flex flex-col
            bg-geo-panel border border-geo-border rounded-lg shadow-xl focus:outline-none"
          data-ourgeo-id="pluginSubmit.dialog"
        >
          <div className="flex items-start justify-between px-5 py-4 border-b border-geo-border shrink-0">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold text-foreground">
                Publish {plugin?.manifest.name ?? 'a plugin'}
              </Dialog.Title>
              <Dialog.Description className="text-[11px] text-geo-muted mt-1 leading-snug">
                A moderator installs and tests every submission before it appears in the store.
                You will see their notes here and on ourgeo.dev either way.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-geo-muted hover:text-foreground shrink-0">
                <X className="w-3.5 h-3.5" />
              </Button>
            </Dialog.Close>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="px-5 py-4 space-y-3">
              {!plugin && (
                <p className="text-xs text-geo-error">That plugin is no longer installed.</p>
              )}

              {plugin && (
                <>
                  <p className="text-[11px] text-geo-muted leading-snug">
                    Publishing <span className="text-foreground">{plugin.manifest.id}</span> v
                    {plugin.manifest.version}. The id is the store&rsquo;s name for it and cannot
                    be changed later — it is also the folder name on every machine that installs it.
                  </p>

                  {/* What is uploaded, stated before it is. */}
                  <div className="rounded border border-geo-border p-2.5 space-y-1">
                    <p className="text-[10px] font-semibold text-geo-muted uppercase tracking-wider">
                      What gets uploaded
                    </p>
                    <p className="text-[11px] text-geo-muted leading-snug">
                      <span className="text-foreground">The built plugin</span> — your manifest, one
                      minified module and any R files. This is what people download. Your
                      TypeScript is not in it.
                    </p>
                    <p className="text-[11px] text-geo-muted leading-snug">
                      <span className="text-foreground">Your source folder</span> — so a moderator
                      can read what they are approving. Only you and ouRGeo&rsquo;s moderators can
                      ever fetch it; it is never public and never served to users.
                    </p>
                    <p className="text-[11px] text-geo-muted leading-snug">
                      Minifying is obfuscation, not encryption. Anything declarative — connectors,
                      tools, actions — travels as readable JSON in the manifest, because ouRGeo has
                      to read it to run it.
                    </p>
                  </div>

                  <Field label="Summary" hint="One line, shown on the card. Required.">
                    <input
                      value={summary}
                      onChange={(e) => setSummary(e.target.value.slice(0, 200))}
                      maxLength={200}
                      className={inputClass}
                      data-ourgeo-id="pluginSubmit.summary"
                    />
                  </Field>

                  <Field label="Description" hint="Markdown. What it does, what it needs, how to use it.">
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value.slice(0, 20000))}
                      rows={6}
                      className={cn(inputClass, 'resize-y font-mono')}
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Category">
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className={inputClass}
                      >
                        {categories.length === 0 && <option value="other">Other</option>}
                        {categories.map((c) => (
                          <option key={c.slug} value={c.slug}>{c.icon} {c.name}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Tags" hint="Comma separated, up to eight.">
                      <input value={tags} onChange={(e) => setTags(e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Homepage">
                      <input value={homepage} onChange={(e) => setHomepage(e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Licence" hint="e.g. MIT, AGPL-3.0.">
                      <input value={license} onChange={(e) => setLicense(e.target.value)} className={inputClass} />
                    </Field>
                  </div>

                  <Field label="What changed" hint="Shown beside this version. Leave blank for a first release.">
                    <textarea
                      value={changelog}
                      onChange={(e) => setChangelog(e.target.value.slice(0, 4000))}
                      rows={3}
                      className={cn(inputClass, 'resize-y')}
                    />
                  </Field>

                  <PluginScreenshots
                    ref={screenshots}
                    slug={plugin.manifest.id}
                    signedIn={signedIn}
                    submitting={busy}
                    onBusyChange={setShotsBusy}
                  />

                  {warnings.length > 0 && (
                    <div className="rounded border border-geo-warning/40 bg-geo-warning/5 p-2 space-y-1">
                      {warnings.map((w) => (
                        <p key={w} className="text-[10px] text-geo-warning leading-snug">{w}</p>
                      ))}
                    </div>
                  )}

                  {phase.kind === 'error' && (
                    <div className="flex items-start gap-2 p-2 bg-geo-error/10 border border-geo-error/30 rounded">
                      <AlertCircle className="w-3 h-3 text-geo-error shrink-0 mt-0.5" />
                      <p className="text-[11px] text-geo-error leading-snug">{phase.message}</p>
                    </div>
                  )}

                  {phase.kind === 'done' && (
                    <div className="flex items-start gap-2 p-2 bg-geo-success/10 border border-geo-success/30 rounded">
                      <CheckCircle2 className="w-3 h-3 text-geo-success shrink-0 mt-0.5" />
                      <p className="text-[11px] text-geo-success leading-snug">
                        Submitted. It is waiting for a moderator — you can follow it on
                        ourgeo.dev, under your account.
                        {phase.screenshots.uploaded > 0 && (
                          <> {phase.screenshots.uploaded} screenshot
                            {phase.screenshots.uploaded === 1 ? ' is' : 's are'} on its page.</>
                        )}
                        {phase.screenshots.failed > 0 && (
                          <> {phase.screenshots.failed} screenshot
                            {phase.screenshots.failed === 1 ? '' : 's'} did not upload — retry
                            {phase.screenshots.failed === 1 ? ' it' : ' them'} above.</>
                        )}
                      </p>
                    </div>
                  )}

                  {!signedIn && (
                    <p className="text-[11px] text-geo-muted leading-snug">
                      Publishing needs your ourgeo.dev account, and an account that has posted
                      three times over two days — the same bar as uploading an image to the forum.
                      You can still save a submission file and upload it later.
                    </p>
                  )}
                </>
              )}
            </div>
          </ScrollArea>

          <div className="flex items-center gap-2 px-5 py-3 border-t border-geo-border shrink-0">
            <Button
              variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-geo-muted"
              disabled={busy || !plugin} onClick={() => void saveFile()}
            >
              <Save className="w-3 h-3" /> Save a submission file…
            </Button>
            <div className="flex-1" />
            <Button
              size="sm" className="h-7 text-xs gap-1.5"
              data-ourgeo-id="pluginSubmit.submit"
              disabled={!canSubmit} onClick={() => void submit()}
            >
              {busy
                ? <><Loader2 className="w-3 h-3 animate-spin" />
                    {phase.kind === 'building' ? 'Building…'
                      : phase.kind === 'attaching' ? 'Attaching screenshots…' : 'Uploading…'}</>
                : <><Upload className="w-3 h-3" /> Submit for review</>}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const inputClass =
  'w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground ' +
  'focus:outline-none focus:border-geo-accent placeholder:text-geo-muted'

function Field({
  label, hint, children,
}: {
  label: string; hint?: string; children: React.ReactNode
}): React.ReactElement {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold text-geo-muted uppercase tracking-wider mb-1">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[10px] text-geo-muted mt-1 leading-snug">{hint}</span>}
    </label>
  )
}
