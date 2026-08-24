import React, { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { rClient, type RLibrary } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import { PackageTagInput } from './PackageTagInput'

interface UpdatePackagesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: () => void
  libraries: RLibrary[]
}

type UpdateScope = 'all' | 'library' | 'specific'

function buildUpdateCode(
  scope: UpdateScope,
  selectedLibs: string[],
  selectedPkgs: string[],
  specificLibPath: string,
  repos: string
): string {
  const reposArg = `repos = "${repos}"`

  if (scope === 'all') {
    return `update.packages(ask = FALSE, checkBuilt = TRUE, ${reposArg})`
  }

  if (scope === 'library') {
    const libArg =
      selectedLibs.length === 1
        ? `lib.loc = "${selectedLibs[0]}"`
        : `lib.loc = c(${selectedLibs.map((l) => `"${l}"`).join(', ')})`
    return `update.packages(${libArg}, ask = FALSE, checkBuilt = TRUE, ${reposArg})`
  }

  // specific — reinstall selected packages at latest version
  const pkgStr =
    selectedPkgs.length === 1
      ? `"${selectedPkgs[0]}"`
      : `c(${selectedPkgs.map((p) => `"${p}"`).join(', ')})`
  const libArg = specificLibPath ? `, lib = "${specificLibPath}"` : ''
  return `install.packages(${pkgStr}, ${reposArg}${libArg})`
}

export function UpdatePackagesDialog({
  open,
  onOpenChange,
  onUpdated,
  libraries,
}: UpdatePackagesDialogProps): React.ReactElement {
  const [scope, setScope] = useState<UpdateScope>('all')
  const [selectedLibs, setSelectedLibs] = useState<Set<string>>(new Set())
  const [selectedPkgs, setSelectedPkgs] = useState<string[]>([])
  const [specificLibPath, setSpecificLibPath] = useState('')
  const [repos, setRepos] = useState('https://cran.r-project.org')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addConsoleEntry = useSessionStore((s) => s.addConsoleEntry)
  const addInputHistory = useSessionStore((s) => s.addInputHistory)

  // Installed non-base packages for the specific-packages scope
  const installedPkgs = libraries
    .flatMap((lib) => lib.packages)
    .filter((pkg) => !pkg.isBase)
    .map((pkg) => ({ name: pkg.name, title: pkg.version }))

  function toggleLib(path: string) {
    setSelectedLibs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function validate(): string | null {
    if (scope === 'library' && selectedLibs.size === 0)
      return 'Select at least one library.'
    if (scope === 'specific' && selectedPkgs.length === 0)
      return 'Select at least one package.'
    return null
  }

  function handleClose() {
    if (loading) return
    onOpenChange(false)
    setError(null)
    setSelectedLibs(new Set())
    setSelectedPkgs([])
  }

  async function handleConfirm() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    const code = buildUpdateCode(scope, Array.from(selectedLibs), selectedPkgs, specificLibPath, repos)
    setError(null)
    setLoading(true)
    addConsoleEntry('input', code)
    addInputHistory(code)

    try {
      await rClient.installPackage(code)
      onOpenChange(false)
      onUpdated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed.')
    } finally {
      setLoading(false)
    }
  }

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
              Update Packages
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-geo-muted hover:text-foreground" disabled={loading}>
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="px-4 py-4 space-y-4">
            {/* Scope selector */}
            <div className="space-y-1">
              <label className="text-xs text-geo-muted">Scope</label>
              <div className="flex items-center gap-4">
                {(['all', 'library', 'specific'] as UpdateScope[]).map((s) => (
                  <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="update-scope"
                      value={s}
                      checked={scope === s}
                      onChange={() => { setScope(s); setError(null) }}
                      className="accent-geo-accent"
                      disabled={loading}
                    />
                    <span className="text-xs text-foreground">
                      {s === 'all' ? 'All' : s === 'library' ? 'By library' : 'Specific packages'}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* All */}
            {scope === 'all' && (
              <p className="text-xs text-geo-muted leading-relaxed">
                Updates all installed non-base packages to their latest CRAN versions.
              </p>
            )}

            {/* By library */}
            {scope === 'library' && (
              <div className="space-y-1">
                <label className="text-xs text-geo-muted">Libraries</label>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {libPaths.map((p) => (
                    <label key={p} className="flex items-start gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={selectedLibs.has(p)}
                        onChange={() => toggleLib(p)}
                        className="accent-geo-accent mt-0.5 flex-shrink-0"
                        disabled={loading}
                      />
                      <span className="text-xs text-foreground break-all leading-relaxed">{p}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Specific packages */}
            {scope === 'specific' && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-geo-muted">Package(s)</label>
                  <PackageTagInput
                    value={selectedPkgs}
                    onChange={setSelectedPkgs}
                    cranPackages={installedPkgs}
                    isLoading={false}
                    disabled={loading}
                  />
                  <p className="text-[10px] text-geo-muted">
                    Only installed non-base packages are listed.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-geo-muted">Library</label>
                  <select
                    value={specificLibPath}
                    onChange={(e) => setSpecificLibPath(e.target.value)}
                    disabled={loading}
                    className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1.5 text-xs text-foreground outline-none focus:border-geo-accent"
                  >
                    <option value="">Default (.libPaths()[1])</option>
                    {libPaths.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Repository */}
            <div className="space-y-1">
              <label className="text-xs text-geo-muted">Repository</label>
              <input
                type="text"
                value={repos}
                onChange={(e) => setRepos(e.target.value)}
                disabled={loading}
                className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1.5 text-xs text-foreground placeholder:text-geo-muted outline-none focus:border-geo-accent"
              />
            </div>

            {/* Error */}
            {error && <p className="text-xs text-geo-error">{error}</p>}
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
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  Updating...
                </>
              ) : (
                'Update'
              )}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
