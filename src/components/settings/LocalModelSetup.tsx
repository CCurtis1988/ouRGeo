import React, { useState } from 'react'
import { Download, Server, CheckCircle2, RefreshCw } from 'lucide-react'
import type { HealthHardware, InstallPlan } from '@/lib/health-types'
import { HEALTH_MODELS, modelFits } from '@/lib/health-policy'
import { LOCAL_PROVIDERS, LOCAL_PROVIDER_MAP, localBaseUrl, localCtxKeyId } from '@/lib/ai-client'
import { inspectLocal } from '@/lib/health-check'
import { useAiStore, type AiProvider } from '@/store/ai'
import { useApiKeysStore } from '@/store/apiKeys'
import { AiProviderSettings } from './AiProviderSettings'

const button = 'rounded border border-geo-border px-3 py-2 text-xs text-foreground hover:bg-geo-bg disabled:opacity-40 disabled:cursor-not-allowed'
const input = 'w-full rounded border border-geo-border bg-geo-bg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-geo-accent'
export function LocalModelSetup({ hardware, locked, onBusy }: { hardware: HealthHardware | null; locked: boolean; onBusy: (busy: boolean) => void }): React.ReactElement {
  const [route, setRoute] = useState<'ollama' | 'existing' | 'cloud'>('ollama')
  const [provider, setProvider] = useState<AiProvider>('lmstudio')
  const [url, setUrl] = useState(localBaseUrl('lmstudio', useApiKeysStore.getState().keys))
  const [token, setToken] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')
  const [plan, setPlan] = useState<InstallPlan | null>(null)
  const [download, setDownload] = useState('')
  const [used, setUsed] = useState('')
  const recommended = hardware ? [...HEALTH_MODELS].reverse().find((m) => modelFits(m, hardware).fits)?.id : undefined
  const freeVram = hardware?.gpus.reduce((best, gpu) => Math.max(best, gpu.freeVramGB ?? 0), 0) ?? 0

  const work = async (fn: () => Promise<void>) => {
    onBusy(true); setNotice('')
    try { await fn() } catch (e) { setNotice(String(e)) } finally { onBusy(false) }
  }
  const recheck = async () => {
    const connection = route === 'ollama' ? await window.electronAPI.health.ollamaModels() : await inspectLocal(provider, { ...useApiKeysStore.getState().keys, [LOCAL_PROVIDER_MAP[provider].urlKeyId]: url, [LOCAL_PROVIDER_MAP[provider].apiKeyId]: token })
    setModels(connection.models); setSelected(connection.models[0] ?? '')
    setNotice(connection.error || `${connection.models.length} model${connection.models.length === 1 ? '' : 's'} available.`)
  }
  const selectModel = (id: string, downloaded = false) => {
    const p = route === 'ollama' ? 'ollama' : provider
    const meta = LOCAL_PROVIDER_MAP[p]
    const keys = useApiKeysStore.getState()
    keys.setKey(meta.urlKeyId, route === 'ollama' ? 'http://127.0.0.1:11434' : url)
    if (route !== 'ollama') keys.setKey(meta.apiKeyId, token)
    if (downloaded) keys.setKey(localCtxKeyId(p), '4096')
    useAiStore.getState().setProvider(p)
    useAiStore.getState().setModel(id)
    setUsed(`${meta.label} · ${id}`)
    setNotice('Saved. Continue to test the assistant connection.')
  }
  return (
    <div className="space-y-4">
      {hardware && <div className="grid grid-cols-3 gap-2 rounded-lg border border-geo-border bg-geo-bg p-3 text-xs">
        <div><p className="text-geo-muted">System RAM</p><p className="font-medium mt-1">{hardware.totalRamGB.toFixed(1)} GB total</p><p className="text-geo-muted mt-1">{hardware.freeRamGB.toFixed(1)} GB available</p></div>
        <div><p className="text-geo-muted">GPU memory</p><p className="font-medium mt-1">{hardware.unifiedMemory ? 'Shared with RAM' : freeVram ? `${freeVram.toFixed(1)} GB available` : 'Not reported'}</p></div>
        <div><p className="text-geo-muted">Model storage</p><p className="font-medium mt-1">{hardware.storage.find((s) => s.label === 'Model storage')?.freeGB?.toFixed(1) ?? 'Unknown'} GB free</p></div>
      </div>}
      <div className="flex flex-wrap gap-2" aria-label="AI setup options">
        {(['ollama', 'existing', 'cloud'] as const).map((r) => <button key={r} className={`${button} ${route === r ? 'border-geo-accent text-geo-accent' : ''}`} disabled={locked} onClick={() => { setRoute(r); setModels([]); setNotice(''); setUsed('') }}>{r === 'ollama' ? 'Set up Ollama' : r === 'existing' ? 'Connect a server' : 'Cloud / subscription'}</button>)}
      </div>
      {route === 'cloud' ? <AiProviderSettings /> : <>
        {route === 'existing' ? <div className="space-y-2">
          <label className="block text-xs">Local provider<select aria-label="Local provider" className={`${input} mt-1`} value={provider} disabled={locked} onChange={(e) => { const p = e.target.value as AiProvider; setProvider(p); setUrl(localBaseUrl(p, useApiKeysStore.getState().keys)); setToken(useApiKeysStore.getState().keys[LOCAL_PROVIDER_MAP[p].apiKeyId] ?? ''); setModels([]) }}>{LOCAL_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          <label className="block text-xs">Server URL<input className={`${input} mt-1`} value={url} disabled={locked} onChange={(e) => { setUrl(e.target.value); setModels([]) }} /></label>
          <label className="block text-xs">API key (if required)<input type="password" className={`${input} mt-1`} autoComplete="off" value={token} disabled={locked} onChange={(e) => setToken(e.target.value)} /></label>
          <p className="text-xs text-geo-muted">{LOCAL_PROVIDER_MAP[provider].description} The model server’s hardware determines which models fit when it runs on another computer.</p>
        </div> : <div className="space-y-2">
          <p className="text-xs text-geo-muted">Ollama runs models on your computer. Start its local server, then choose a model below. Downloads use your internet connection and storage.</p>
          <div className="flex flex-wrap gap-2">
            <button className={button} disabled={locked} onClick={() => void work(async () => setPlan(await window.electronAPI.health.installPlan('ollama')))}>Install Ollama…</button>
            <button className={button} disabled={locked} onClick={() => void work(async () => { await window.electronAPI.health.startOllama(true); await recheck() })}><Server className="inline w-3 h-3 mr-1" />Start local server</button>
          </div>
          {plan && <div className="rounded border border-geo-border bg-geo-bg p-3 space-y-2">
            <p className="text-xs font-medium">{plan.label}</p><p className="text-xs text-geo-muted">{plan.detail}</p>
            <button className={button} disabled={locked} onClick={() => void work(async () => { if (plan.command) { await window.electronAPI.health.install('ollama', true); setPlan(null); setNotice('Ollama installed. Start the local server to continue.') } else await window.electronAPI.shell.openExternal(plan.manualUrl) })}>{plan.command ? 'Approve and install Ollama' : 'Open official download page'}</button>
          </div>}
        </div>}
        <button className={button} disabled={locked} onClick={() => void work(recheck)}><RefreshCw className="inline w-3 h-3 mr-1" />Check server and list models</button>
        {models.length > 0 && <div className="flex gap-2"><select aria-label="Available model" className={input} value={selected} disabled={locked} onChange={(e) => setSelected(e.target.value)}>{models.map((m) => <option key={m} value={m}>{m}</option>)}</select><button className={`${button} shrink-0`} disabled={locked || !selected} onClick={() => selectModel(selected)}>Use this model</button></div>}
        {route === 'ollama' && hardware && <div className="space-y-2">
          <p className="text-xs font-medium">Models for this computer · Qwen preferred</p>
          <p className="text-xs text-geo-muted">Estimates allow a 4K context and reserve memory for ouRGeo. Larger contexts need more memory; actual speed depends on your hardware. <a className="text-geo-accent underline" href="https://ollama.com/library/qwen3/tags" onClick={(e) => { e.preventDefault(); void window.electronAPI.shell.openExternal('https://ollama.com/library/qwen3/tags') }}>Model details</a></p>
          {HEALTH_MODELS.map((m) => { const fit = modelFits(m, hardware); return <label key={m.id} className={`block rounded border p-3 ${download === m.id ? 'border-geo-accent' : 'border-geo-border'} ${fit.fits ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs"><input type="radio" name="recommended-model" checked={download === m.id} disabled={locked || !fit.fits} onChange={() => setDownload(m.id)} /><span className="font-medium">{m.label}</span>{m.id === recommended && <span className="text-[11px] text-geo-accent">Recommended</span>}<span className="ml-auto text-geo-muted">{m.downloadGB} GB download</span></div>
            <p className="text-xs text-geo-muted mt-1 ml-5">{m.note} {fit.mode}</p>
          </label> })}
          {download && <div className="rounded border border-geo-accent p-3 space-y-2">
            <p className="text-xs">Download {HEALTH_MODELS.find((m) => m.id === download)?.label} and make it the assistant’s model? This stores its weights locally and uses no AI credits.</p>
            <button className={button} disabled={locked} onClick={() => void work(async () => { await window.electronAPI.health.pullModel(download, true); const check = await window.electronAPI.health.ollamaModels(); if (!check.models.includes(download)) throw new Error('The downloaded model was not found. Recheck Ollama.'); selectModel(download, true); setModels(check.models); setSelected(download); setDownload('') })}><Download className="inline w-3 h-3 mr-1" />Approve download and use model</button>
          </div>}
        </div>}
      </>}
      {used && <p className="text-xs text-geo-success"><CheckCircle2 className="inline w-3 h-3 mr-1" />{used}</p>}
      {notice && <p role="status" className="text-xs text-geo-muted break-words">{notice}</p>}
    </div>
  )
}
