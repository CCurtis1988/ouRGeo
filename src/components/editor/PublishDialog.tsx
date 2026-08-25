import React, { useCallback, useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  X, Upload, Loader2, ExternalLink, AlertTriangle, LogOut, Github, Mail, Chrome,
} from 'lucide-react'
import { Button } from '../ui/button'
import { useSessionStore } from '@/store/session'
import {
  useForumStore, canUploadImages, uploadBlockedReason, type PublishPhase,
} from '@/store/forum'
import { knitToMarkdown, publish, forumErrorMessage } from '@/lib/forum/publish'
import { FORUM_LIMITS, defaultTitle, type PreparedPost } from '@/lib/forum/publish-markdown'
import { readFrontMatterKeys, splitFrontMatter } from '@/lib/markdown/front-matter'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  filePath: string | null
  isDirty: boolean
  /** Current buffer, for the default title. */
  content: string
  /** Save the document first; resolves to its path, or null if cancelled. */
  onSaveRequest: () => Promise<string | null>
}

const DEFAULT_CATEGORY = 'showcase'

/**
 * Publish an R Markdown document to the ouRGeo forum.
 *
 * Publishing is outward-facing and the app has no way to delete a thread
 * afterwards, so this deliberately makes the user look at what will be posted —
 * the knitted body, the figure count, and anything the forum's renderer will
 * change — before the button that sends it is enabled.
 */
export function PublishDialog({
  open, onOpenChange, filePath, isDirty, content, onSaveRequest,
}: Props): React.ReactElement {
  const profile = useForumStore((s) => s.profile)
  const categories = useForumStore((s) => s.categories)
  const busy = useForumStore((s) => s.busy)
  const phase = useForumStore((s) => s.phase)
  const setProfile = useForumStore((s) => s.setProfile)
  const setCategories = useForumStore((s) => s.setCategories)
  const setBusy = useForumStore((s) => s.setBusy)
  const setPhase = useForumStore((s) => s.setPhase)
  const addEntry = useSessionStore((s) => s.addConsoleEntry)

  const [email, setEmail] = useState('')
  const [emailSent, setEmailSent] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [category, setCategory] = useState(DEFAULT_CATEGORY)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [prepared, setPrepared] = useState<PreparedPost | null>(null)
  const [outputDir, setOutputDir] = useState<string | null>(null)

  const signedIn = !!profile

  // Restore a previous session when the dialog opens, so a returning user does
  // not have to sign in on every publish.
  useEffect(() => {
    if (!open || profile) return
    setBusy(true)
    void window.electronAPI.forum.restore()
      .then((p) => { if (p) setProfile(p) })
      .catch(() => { /* offline; the sign-in buttons still work */ })
      .finally(() => setBusy(false))
  }, [open, profile, setProfile, setBusy])

  useEffect(() => {
    if (!signedIn) return
    void window.electronAPI.forum.postableCategories()
      .then((c) => {
        setCategories(c)
        if (!c.some((x) => x.slug === category)) setCategory(c[0]?.slug ?? DEFAULT_CATEGORY)
      })
      .catch(() => { /* the select falls back to showcase */ })
    // `category` intentionally excluded: this only picks a fallback on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, setCategories])

  // Seed the title from the document's own YAML title, which is what the author
  // already chose to call it.
  useEffect(() => {
    if (!open) return
    const keys = readFrontMatterKeys(splitFrontMatter(content).frontMatter)
    const name = (filePath ?? 'untitled').split(/[\\/]/).pop() ?? 'untitled'
    setTitle((t) => t || defaultTitle(keys.title, name))
  }, [open, content, filePath])

  const signIn = useCallback(async (provider: 'google' | 'github' | 'email') => {
    setAuthError(null)
    setEmailSent(false)
    setBusy(true)
    try {
      if (provider === 'email') {
        // The magic link arrives by mail and lands on the loopback listener, so
        // the sign-in resolves whenever they click it — possibly minutes later.
        setEmailSent(true)
      }
      const p = await window.electronAPI.forum.signIn({ provider, email })
      setProfile(p)
      setEmailSent(false)
    } catch (e) {
      setAuthError(forumErrorMessage(e))
      setEmailSent(false)
    } finally {
      setBusy(false)
    }
  }, [email, setBusy, setProfile])

  const signOut = useCallback(async () => {
    await window.electronAPI.forum.signOut()
    setProfile(null)
    setPrepared(null)
  }, [setProfile])

  /** Knit and prepare, so the preview shows exactly what would be posted. */
  const runKnit = useCallback(async () => {
    let path = filePath
    if (!path || isDirty) {
      path = await onSaveRequest()
      if (!path) return
    }
    setPhase({ kind: 'knitting' })
    try {
      const dir = `${await window.electronAPI.app.getDataPath()}/publish-preview`
      const { prepared: p } = await knitToMarkdown(path, dir, (t) => {
        const trimmed = t.trim()
        if (trimmed) addEntry('output', trimmed)
      })
      setPrepared(p)
      setBody(p.body)
      setOutputDir(dir)
      setPhase({ kind: 'idle' })
    } catch (e) {
      setPhase({ kind: 'error', message: forumErrorMessage(e) })
    }
  }, [filePath, isDirty, onSaveRequest, setPhase, addEntry])

  const doPublish = useCallback(async () => {
    if (!prepared || !outputDir) return
    try {
      const res = await publish({
        filePath: filePath ?? '',
        category,
        title: title.trim(),
        body,
        images: canUploadImages(profile) ? prepared.images : [],
        outputDir,
        onPhase: setPhase,
      })
      setPhase({ kind: 'done', url: res.url })
      addEntry('info', `Published to the ouRGeo forum: ${res.url}`)
      if (res.imageError) addEntry('error', `Figures were not attached: ${res.imageError}`)
    } catch (e) {
      setPhase({ kind: 'error', message: forumErrorMessage(e) })
    }
  }, [prepared, outputDir, filePath, category, title, body, profile, setPhase, addEntry])

  const uploadBlocked = uploadBlockedReason(profile)
  const overLength = body.length > FORUM_LIMITS.bodyMax
  const titleBad = title.trim().length < 3 || title.length > FORUM_LIMITS.titleMax
  const canPost =
    !!prepared && prepared.errors.length === 0 && !overLength && !titleBad &&
    phase.kind !== 'posting' && phase.kind !== 'uploading' && phase.kind !== 'knitting'

  const bannedUntil = profile?.bannedUntil ? new Date(profile.bannedUntil) : null
  const banned = !!bannedUntil && bannedUntil > new Date()

  const imageNote = useMemo(() => {
    if (!prepared) return null
    if (!prepared.images.length) return 'No figures.'
    if (uploadBlocked) return `${prepared.images.length} figures — these will be left out.`
    return `${prepared.images.length} of ${FORUM_LIMITS.imagesPerPost} figures will be uploaded.`
  }, [prepared, uploadBlocked])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[200]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[201]
            w-[680px] max-h-[86vh] bg-geo-panel border border-geo-border rounded-lg shadow-xl
            flex flex-col focus:outline-none"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-geo-border shrink-0">
            <div>
              <Dialog.Title className="text-sm font-semibold text-foreground">
                Publish to the ouRGeo forum
              </Dialog.Title>
              <p className="text-[11px] text-geo-muted mt-0.5">
                Knits this document and posts it as a new discussion.
              </p>
            </div>
            <Dialog.Close className="text-geo-muted hover:text-foreground">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="px-4 py-3 overflow-y-auto flex flex-col gap-3">
            {!signedIn && (
              <SignIn
                busy={busy}
                email={email}
                emailSent={emailSent}
                error={authError}
                onEmail={setEmail}
                onSignIn={signIn}
              />
            )}

            {signedIn && (
              <>
                <div className="flex items-center justify-between text-[11px] text-geo-muted">
                  <span>
                    Signed in as <span className="text-foreground">{profile.displayName}</span>
                    {' · '}trust level {profile.trustLevel}
                    {profile.quota > 0 && (
                      <> · {Math.round(profile.bytesUsed / 1024)} of {Math.round(profile.quota / 1024 / 1024)} MB used</>
                    )}
                  </span>
                  <button onClick={() => void signOut()} className="flex items-center gap-1 hover:text-foreground">
                    <LogOut className="w-3 h-3" /> Sign out
                  </button>
                </div>

                {banned && (
                  <Notice tone="error">
                    Your forum account is suspended until {bannedUntil.toLocaleString()}.
                  </Notice>
                )}

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-geo-muted">Category</span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs
                      text-foreground focus:outline-none focus:border-geo-accent"
                  >
                    {(categories.length ? categories : [{
                      slug: DEFAULT_CATEGORY, name: 'Showcase', icon: '🖼️', description: '', minRoleToPost: 'user',
                    }]).map((c) => (
                      <option key={c.slug} value={c.slug}>{c.icon} {c.name}</option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-geo-muted">
                    Title <span className={cn(title.length > FORUM_LIMITS.titleMax && 'text-geo-error')}>
                      ({title.length}/{FORUM_LIMITS.titleMax})
                    </span>
                  </span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs
                      text-foreground focus:outline-none focus:border-geo-accent"
                  />
                </label>

                {!prepared && (
                  <Button
                    size="sm"
                    className="h-7 text-xs self-start"
                    disabled={phase.kind === 'knitting'}
                    onClick={() => void runKnit()}
                  >
                    {phase.kind === 'knitting'
                      ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Knitting…</>
                      : 'Knit and preview'}
                  </Button>
                )}

                {prepared && (
                  <>
                    {prepared.errors.map((e, i) => <Notice key={i} tone="error">{e}</Notice>)}
                    {prepared.warnings.map((w, i) => <Notice key={i} tone="warn">{w}</Notice>)}
                    {uploadBlocked && <Notice tone="warn">{uploadBlocked}</Notice>}

                    <div className="flex items-center justify-between text-[11px] text-geo-muted">
                      <span>{imageNote}</span>
                      <span className={cn(overLength && 'text-geo-error')}>
                        {body.length.toLocaleString()} / {FORUM_LIMITS.bodyMax.toLocaleString()} characters
                      </span>
                    </div>

                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      spellCheck={false}
                      className="bg-geo-bg border border-geo-border rounded px-2 py-1.5 text-[11px]
                        font-mono text-foreground focus:outline-none focus:border-geo-accent
                        h-64 resize-y leading-relaxed"
                    />
                    <p className="text-[10px] text-geo-muted -mt-1">
                      This is exactly what will be posted. Figure paths become links once uploaded.
                    </p>
                  </>
                )}

                <Progress phase={phase} />
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-geo-border shrink-0">
            <span className="text-[10px] text-geo-muted">
              {signedIn && 'Posting is public and cannot be undone from ouRGeo.'}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onOpenChange(false)}>
                {phase.kind === 'done' ? 'Close' : 'Cancel'}
              </Button>
              {signedIn && phase.kind !== 'done' && (
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={!canPost || banned}
                  onClick={() => void doPublish()}
                >
                  <Upload className="w-3 h-3" />
                  Publish
                </Button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'error'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded border px-2.5 py-1.5 text-[11px] leading-snug',
        tone === 'error'
          ? 'border-geo-error/40 bg-geo-error/10 text-geo-error'
          : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-500'
      )}
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
      <span>{children}</span>
    </div>
  )
}

function Progress({ phase }: { phase: PublishPhase }): React.ReactElement | null {
  if (phase.kind === 'idle' || phase.kind === 'knitting') return null
  if (phase.kind === 'error') return <Notice tone="error">{phase.message}</Notice>
  if (phase.kind === 'done') {
    return (
      <div className="flex items-center gap-2 text-[11px] text-geo-success">
        Published.
        <button
          className="flex items-center gap-1 text-geo-accent hover:underline"
          onClick={() => void window.electronAPI.shell.openExternal(phase.url)}
        >
          Open the discussion <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 text-[11px] text-geo-muted">
      <Loader2 className="w-3 h-3 animate-spin text-geo-accent" />
      {phase.kind === 'uploading'
        ? `Uploading figure ${phase.done + 1} of ${phase.total}…`
        : 'Posting…'}
    </div>
  )
}

function SignIn({
  busy, email, emailSent, error, onEmail, onSignIn,
}: {
  busy: boolean
  email: string
  emailSent: boolean
  error: string | null
  onEmail: (v: string) => void
  onSignIn: (p: 'google' | 'github' | 'email') => void
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-geo-muted leading-relaxed">
        Publishing needs a free forum account. ouRGeo opens the sign-in page in your
        browser — no password is ever typed into this app.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {emailSent && (
        <Notice tone="warn">
          Check your email and click the sign-in link. This window will continue once you do.
        </Notice>
      )}
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs gap-1" disabled={busy} onClick={() => onSignIn('google')}>
          <Chrome className="w-3 h-3" /> Google
        </Button>
        <Button size="sm" className="h-7 text-xs gap-1" disabled={busy} onClick={() => onSignIn('github')}>
          <Github className="w-3 h-3" /> GitHub
        </Button>
      </div>
      <div className="flex gap-2 items-end">
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-[11px] text-geo-muted">…or a sign-in link by email</span>
          <input
            value={email}
            onChange={(e) => onEmail(e.target.value)}
            placeholder="you@example.com"
            className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs
              text-foreground focus:outline-none focus:border-geo-accent"
          />
        </label>
        <Button
          variant="ghost" size="sm" className="h-7 text-xs gap-1"
          disabled={busy || !email.trim()}
          onClick={() => onSignIn('email')}
        >
          <Mail className="w-3 h-3" /> Send link
        </Button>
      </div>
      {busy && (
        <div className="flex items-center gap-2 text-[11px] text-geo-muted">
          <Loader2 className="w-3 h-3 animate-spin text-geo-accent" /> Waiting for the browser…
        </div>
      )}
    </div>
  )
}
