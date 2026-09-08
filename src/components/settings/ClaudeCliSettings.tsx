import React, { useCallback, useEffect, useState } from 'react'
import { RefreshCw, FolderOpen, CheckCircle2, AlertCircle } from 'lucide-react'

/**
 * Configuring the one provider that has no API key.
 *
 * A Claude subscription cannot be pasted into a field, so this row shows the
 * two facts that decide whether the provider works — which `claude` ouRGeo
 * found, and who it is signed in as — and says plainly what the arrangement
 * is. The blank where the key field would be is the feature; leaving it
 * unexplained would read as something missing.
 */

const btn =
  'px-2 py-1 text-xs rounded border border-geo-border text-foreground hover:bg-geo-bg ' +
  'flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed'

interface Install { path: string; version: string }
interface Auth {
  loggedIn: boolean
  authMethod: string | null
  subscriptionType: string | null
  email: string | null
  error?: string
}

export function ClaudeCliSettings(): React.ReactElement {
  const [install, setInstall] = useState<Install | null>(null)
  const [auth, setAuth] = useState<Auth | null>(null)
  const [busy, setBusy] = useState(true)

  const probe = useCallback(async () => {
    const api = window.electronAPI?.claudeCli
    if (!api) { setBusy(false); return }
    setBusy(true)
    const found = await api.detect()
    setInstall(found)
    setAuth(found ? await api.authStatus(found.path) : null)
    setBusy(false)
  }, [])

  useEffect(() => { void probe() }, [probe])

  const browse = useCallback(async () => {
    const api = window.electronAPI?.claudeCli
    if (!api) return
    const picked = await api.browse()
    if (!picked) return
    await api.setPath(picked)
    await probe()
  }, [probe])

  // `authMethod: "claude.ai"` is the subscription path. An `apiKey` there means
  // the CLI is billing an API account, which is worth saying out loud rather
  // than letting someone find it on an invoice.
  const onSubscription = auth?.loggedIn && auth.authMethod === 'claude.ai'
  const plan = auth?.subscriptionType

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-geo-muted">
        This provider has no API key. It runs the <span className="font-mono">claude</span> command
        you installed and signed in to, on this machine, and reads its answer — so ouRGeo never
        sees your credentials. Usage counts against that plan&rsquo;s limits, not an API balance.
        Whether your plan covers this use is between you and Anthropic&rsquo;s terms.
      </p>

      <div className="rounded border border-geo-border bg-geo-bg px-2 py-1.5 flex flex-col gap-1">
        {busy ? (
          <span className="text-[11px] text-geo-muted">Looking for the Claude Code CLI…</span>
        ) : !install ? (
          <span className="text-[11px] text-geo-error flex items-start gap-1">
            <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>
              Not found. Install Claude Code, or point ouRGeo at it with Browse — on macOS a
              windowed app does not inherit your shell&rsquo;s PATH, so a working{' '}
              <span className="font-mono">claude</span> in the terminal can still be invisible here.
            </span>
          </span>
        ) : (
          <>
            <span className="text-[11px] text-foreground flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-geo-success flex-shrink-0" />
              <span className="font-mono truncate">{install.path}</span>
              {install.version && <span className="text-geo-muted">v{install.version}</span>}
            </span>
            {auth?.loggedIn ? (
              <span className="text-[11px] text-geo-muted">
                Signed in{auth.email ? <> as <span className="font-mono">{auth.email}</span></> : null}
                {onSubscription
                  ? <> · {plan ? `${plan} subscription` : 'Claude subscription'}</>
                  : <> · billing an API account, not a subscription</>}
              </span>
            ) : (
              <span className="text-[11px] text-geo-error">
                Not signed in. Run <span className="font-mono">claude auth login</span> in the
                terminal panel, then refresh.
              </span>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={() => void probe()} disabled={busy}>
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
        <button type="button" className={btn} onClick={() => void browse()}>
          <FolderOpen className="w-3 h-3" />
          Browse…
        </button>
      </div>

      <p className="text-[11px] text-geo-muted">
        Each answer starts a fresh <span className="font-mono">claude</span> process, so the first
        token takes a few seconds longer than an API key would. ouRGeo runs it with every built-in
        tool switched off and your own Claude Code settings, hooks and CLAUDE.md files ignored: the
        only tools it gets are ouRGeo&rsquo;s, under the same switches as every other provider.
      </p>
    </div>
  )
}
