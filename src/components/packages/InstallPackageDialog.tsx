import React, { useState, useEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Loader2, FolderOpen } from 'lucide-react'
import { Button } from '../ui/button'
import { rClient, type RLibrary } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import { PackageTagInput } from './PackageTagInput'

interface InstallPackageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInstalled: () => void
  libraries: RLibrary[]
}

type InstallSource = 'cran' | 'local' | 'remote'

function buildCode(
  source: InstallSource,
  cranNames: string[],
  localPath: string,
  localType: 'source' | 'binary',
  remoteSpec: string,
  libPath: string
): string {
  const libArg = libPath ? `, lib = "${libPath}"` : ''

  if (source === 'cran') {
    const nameStr =
      cranNames.length === 1
        ? `"${cranNames[0]}"`
        : `c(${cranNames.map((n) => `"${n}"`).join(', ')})`
    return `install.packages(${nameStr}, repos = "https://cran.r-project.org"${libArg})`
  }

  if (source === 'local') {
    return `install.packages("${localPath}", repos = NULL, type = "${localType}"${libArg})`
  }

  // remote
  const spec = remoteSpec.trim()
  if (spec.startsWith('bioc::'))
    return `BiocManager::install("${spec.slice(6)}"${libArg})`
  if (spec.startsWith('https://') || spec.startsWith('http://'))
    return `remotes::install_url("${spec}"${libArg})`
  if (spec.startsWith('gitlab::'))
    return `remotes::install_gitlab("${spec.slice(8)}"${libArg})`
  return `remotes::install_github("${spec}"${libArg})`
}

function detectLocalType(path: string): 'source' | 'binary' {
  if (path.endsWith('.zip')) return 'binary'
  return 'source'
}

export function InstallPackageDialog({
  open,
  onOpenChange,
  onInstalled,
  libraries
}: InstallPackageDialogProps): React.ReactElement {
  const [source, setSource] = useState<InstallSource>('cran')
  const [selectedPkgs, setSelectedPkgs] = useState<string[]>([])
  const [cranPkgs, setCranPkgs] = useState<{ name: string; title: string }[]>([])
  const [cranLoading, setCranLoading] = useState(false)
  const cranFetchedRef = useRef(false)
  const [localPath, setLocalPath] = useState('')
  const [localType, setLocalType] = useState<'source' | 'binary'>('source')
  const [remoteSpec, setRemoteSpec] = useState('')
  const [libPath, setLibPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addConsoleEntry = useSessionStore((s) => s.addConsoleEntry)
  const addInputHistory = useSessionStore((s) => s.addInputHistory)

  const hasElectron =
    typeof window !== 'undefined' && !!window.electronAPI?.dialog?.openPackageFile

  // Fetch CRAN list once (first time CRAN tab is visible while dialog is open)
  useEffect(() => {
    if (!open || source !== 'cran' || cranFetchedRef.current) return
    cranFetchedRef.current = true
    setCranLoading(true)
    rClient.getCranList().then((res) => {
      if (res.success) setCranPkgs(res.packages)
    }).catch(() => {}).finally(() => setCranLoading(false))
  }, [open, source])

  // Reset cranFetchedRef when dialog closes so fresh fetch on next open (skipped if cached in R)
  useEffect(() => {
    if (!open) cranFetchedRef.current = cranPkgs.length > 0
  }, [open, cranPkgs.length])

  function handleClose() {
    if (loading) return
    onOpenChange(false)
    setError(null)
    setSelectedPkgs([])
  }

  async function handleBrowse() {
    if (!hasElectron) return
    const path = await window.electronAPI.dialog.openPackageFile()
    if (path) {
      setLocalPath(path)
      setLocalType(detectLocalType(path))
    }
  }

  function validate(): string | null {
    if (source === 'cran' && selectedPkgs.length === 0) return 'Select at least one package.'
    if (source === 'local' && !localPath.trim()) return 'Select or enter a local file path.'
    if (source === 'remote' && !remoteSpec.trim()) return 'Enter a package spec.'
    return null
  }

  async function handleConfirm() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    const code = buildCode(source, selectedPkgs, localPath, localType, remoteSpec, libPath)
    setError(null)
    setLoading(true)

    addConsoleEntry('input', code)
    addInputHistory(code)

    try {
      await rClient.installPackage(code)
      onOpenChange(false)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Installation failed.')
    } finally {
      setLoading(false)
    }
  }

  const previewCode =
    source === 'remote' && remoteSpec.trim()
      ? buildCode('remote', [], '', 'source', remoteSpec, libPath)
      : null

  const libPaths = libraries.map((l) => l.path)

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] bg-geo-panel border border-geo-border rounded-md shadow-xl focus:outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-geo-border">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              Install Package
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-geo-muted hover:text-foreground" disabled={loading}>
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="px-4 py-4 space-y-4">
            {/* Source selector */}
            <div className="flex items-center gap-4">
              {(['cran', 'local', 'remote'] as InstallSource[]).map((s) => (
                <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="install-source"
                    value={s}
                    checked={source === s}
                    onChange={() => { setSource(s); setError(null) }}
                    className="accent-geo-accent"
                    disabled={loading}
                  />
                  <span className="text-xs text-foreground capitalize">{s === 'cran' ? 'CRAN' : s === 'local' ? 'Local File' : 'Remote'}</span>
                </label>
              ))}
            </div>

            {/* CRAN */}
            {source === 'cran' && (
              <div className="space-y-1">
                <label className="text-xs text-geo-muted">Package(s)</label>
                <PackageTagInput
                  value={selectedPkgs}
                  onChange={setSelectedPkgs}
                  cranPackages={cranPkgs}
                  isLoading={cranLoading}
                  disabled={loading}
                />
              </div>
            )}

            {/* Local */}
            {source === 'local' && (
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-xs text-geo-muted">File</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={localPath}
                      onChange={(e) => {
                        setLocalPath(e.target.value)
                        setLocalType(detectLocalType(e.target.value))
                      }}
                      placeholder="/path/to/pkg.tar.gz"
                      disabled={loading}
                      className="flex-1 bg-geo-bg border border-geo-border rounded px-2 py-1.5 text-xs text-foreground placeholder:text-geo-muted outline-none focus:border-geo-accent"
                    />
                    {hasElectron && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7 px-2 text-geo-muted hover:text-foreground border border-geo-border"
                        onClick={handleBrowse}
                        disabled={loading}
                      >
                        <FolderOpen className="w-3 h-3 mr-1" />
                        Browse
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-geo-muted">Type:</span>
                  {(['source', 'binary'] as const).map((t) => (
                    <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="local-type"
                        value={t}
                        checked={localType === t}
                        onChange={() => setLocalType(t)}
                        className="accent-geo-accent"
                        disabled={loading}
                      />
                      <span className="text-xs text-foreground capitalize">{t}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Remote */}
            {source === 'remote' && (
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-xs text-geo-muted">Spec</label>
                  <input
                    type="text"
                    value={remoteSpec}
                    onChange={(e) => setRemoteSpec(e.target.value)}
                    placeholder="e.g. tidyverse/ggplot2"
                    disabled={loading}
                    className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1.5 text-xs text-foreground placeholder:text-geo-muted outline-none focus:border-geo-accent"
                  />
                </div>
                {previewCode && (
                  <div className="bg-geo-bg rounded px-2 py-1.5">
                    <p className="text-[10px] text-geo-muted mb-0.5">Preview</p>
                    <code className="text-[10px] text-geo-accent break-all">{previewCode}</code>
                  </div>
                )}
                <p className="text-[10px] text-geo-muted leading-relaxed">
                  Formats: <span className="text-foreground">user/repo[@ref]</span> · <span className="text-foreground">bioc::pkg</span> · <span className="text-foreground">https://url</span> · <span className="text-foreground">gitlab::user/repo</span>
                  <br />
                  Requires: <span className="text-foreground">remotes</span> (or <span className="text-foreground">BiocManager</span> for bioc:: specs)
                </p>
              </div>
            )}

            {/* Library path */}
            <div className="space-y-1">
              <label className="text-xs text-geo-muted">Library</label>
              <select
                value={libPath}
                onChange={(e) => setLibPath(e.target.value)}
                disabled={loading}
                className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1.5 text-xs text-foreground outline-none focus:border-geo-accent"
              >
                <option value="">Default (.libPaths()[1])</option>
                {libPaths.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs text-geo-error">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-geo-border">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="text-xs bg-geo-accent hover:bg-geo-accent/90 text-white"
              onClick={handleConfirm}
              disabled={loading || (source === 'cran' && selectedPkgs.length === 0)}
            >
              {loading ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  Installing...
                </>
              ) : (
                'Install'
              )}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
