import React, { useEffect, useState } from 'react'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { reconnectToR } from '@/lib/reconnect-r'

interface RInstallation {
  path: string
  version: string
}

type PickerStatus = 'idle' | 'restarting' | 'done' | 'error'

export function RVersionPicker(): React.ReactElement {
  const [installations, setInstallations] = useState<RInstallation[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<PickerStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const [installs, configured] = await Promise.all([
          window.electronAPI.r.detectInstallations(),
          window.electronAPI.r.getConfiguredPath()
        ])
        setInstallations(installs)
        // If configured path not in list, add it
        if (configured && !installs.find((i) => i.path === configured)) {
          setInstallations((prev) => [{ path: configured, version: 'Configured path' }, ...prev])
        }
        setSelected(configured ?? installs[0]?.path ?? null)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function applySelection(path: string): Promise<void> {
    setSelected(path)
    setStatus('restarting')
    setErrorMsg('')
    try {
      await window.electronAPI.r.setAndRestartR(path)
      await reconnectToR()
      setStatus('done')
      setTimeout(() => setStatus('idle'), 2500)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to restart R')
      setStatus('error')
    }
  }

  async function handleBrowse(): Promise<void> {
    const path = await window.electronAPI.r.browseRscript()
    if (!path) return
    if (!installations.find((i) => i.path === path)) {
      setInstallations((prev) => [...prev, { path, version: 'Custom path' }])
    }
    await applySelection(path)
  }

  if (loading) {
    return <p className="text-xs text-geo-muted">Detecting R installations…</p>
  }

  if (installations.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-geo-error">No R installations detected.</p>
        <button
          onClick={handleBrowse}
          className="flex items-center gap-1.5 text-xs text-geo-accent hover:text-foreground transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Browse for Rscript…
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {installations.map((install) => {
          const isSelected = selected === install.path
          return (
            <button
              key={install.path}
              disabled={status === 'restarting'}
              onClick={() => applySelection(install.path)}
              className={`w-full text-left rounded border px-3 py-2 transition-all ${
                isSelected
                  ? 'border-geo-accent bg-geo-accent/10'
                  : 'border-geo-border hover:border-geo-muted'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <p className="text-xs font-medium text-foreground truncate">{install.version}</p>
              <p className="text-[11px] text-geo-muted truncate mt-0.5">{install.path}</p>
            </button>
          )
        })}
      </div>

      <button
        disabled={status === 'restarting'}
        onClick={handleBrowse}
        className="flex items-center gap-1.5 text-xs text-geo-accent hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <FolderOpen className="w-3.5 h-3.5" />
        Browse for Rscript…
      </button>

      {status === 'restarting' && (
        <div className="flex items-center gap-1.5 text-xs text-geo-muted">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Restarting R…
        </div>
      )}
      {status === 'done' && (
        <p className="text-xs text-geo-success">R restarted successfully.</p>
      )}
      {status === 'error' && (
        <p className="text-xs text-geo-error">Error: {errorMsg}</p>
      )}
    </div>
  )
}
