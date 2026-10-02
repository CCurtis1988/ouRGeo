import React, { useEffect } from 'react'
import { useChatGptStore } from '@/store/chatgpt'

const button = 'px-2 py-1 text-xs rounded border border-geo-border text-foreground hover:bg-geo-bg disabled:opacity-40'

export function ChatGptSettings(): React.ReactElement {
  const { status, loading, error, refresh, act } = useChatGptStore()
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!status?.signingIn) return
    const timer = setInterval(() => { void refresh() }, 1500)
    return () => clearInterval(timer)
  }, [status?.signingIn, refresh])
  const api = window.electronAPI?.chatgpt
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-geo-muted">
        Continue with ChatGPT to authorise ouRGeo to use your eligible plan and credits.
        You control the app&rsquo;s allowance in ChatGPT Settings → Usage. Availability depends
        on your account and workspace; this OpenAI integration is currently in preview.
      </p>
      {status && status.accounts.length > 0 && (
        <label className="flex flex-col gap-1 text-xs text-foreground">
          ChatGPT account / workspace
          <select value={status.activeId ?? ''} disabled={loading || status.signingIn}
            onChange={(e) => void act(() => api.select(e.target.value))}
            className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground">
            {status.accounts.map((a, i) => (
              <option key={a.id} value={a.id}>{a.email ?? 'ChatGPT account'} · registration {i + 1}{a.signedIn ? '' : ' (signed out)'}</option>
            ))}
          </select>
        </label>
      )}
      <p className="text-[11px] text-geo-muted" role="status">
        {status?.signingIn ? 'Complete sign-in in your browser…'
          : status?.signedIn ? status.planEnabled ? 'Connected · ChatGPT plan usage enabled' : 'Connected · ChatGPT plan usage is not enabled'
            : 'Sign in to choose the models available to your ChatGPT account.'}
      </p>
      {error && <p role="alert" className="text-[11px] text-geo-error">{error}</p>}
      {status && !status.persistent && (
        <p className="text-[11px] text-geo-muted">Your system keyring is unavailable. Sign-in lasts for this app session; credentials are kept in memory.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {status?.signingIn ? (
          <button className={button} onClick={() => void act(() => api.cancel())}>Cancel sign-in</button>
        ) : (
          <>
            {(!status?.signedIn || !status.planEnabled) && (
              <button className={button} disabled={loading} onClick={() => void act(() => api.signIn(status?.activeId ?? undefined))}>
                {status?.signedIn ? 'Enable ChatGPT plan usage' : 'Continue with ChatGPT'}
              </button>
            )}
            {status?.accounts.length ? <button className={button} disabled={loading} onClick={() => void act(() => api.signIn())}>Add account</button> : null}
            {status?.signedIn && <button className={button} disabled={loading} onClick={() => void act(() => api.signOut())}>Sign out</button>}
          </>
        )}
        <button className={button} disabled={loading} onClick={() => void refresh()}>Refresh</button>
        <button className={button} onClick={() => void act(() => api.usage())}>Manage usage and credits</button>
      </div>
    </div>
  )
}
