import React, { useEffect, useCallback, useState, useRef } from 'react'
import { RefreshCw, Search, X, Loader2, ChevronDown, ChevronRight, Download, FolderPlus, ArrowUpToLine } from 'lucide-react'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { PackageItem } from './PackageItem'
import { InstallPackageDialog } from './InstallPackageDialog'
import { UpdatePackagesDialog } from './UpdatePackagesDialog'
import { AddLibraryDialog } from './AddLibraryDialog'
import { usePackagesStore } from '@/store/packages'
import { useSessionStore } from '@/store/session'
import { rClient } from '@/lib/r-client'

export function PackagePanel(): React.ReactElement {
  const { libraries, isLoading, error, searchQuery } = usePackagesStore()
  const setLibraries = usePackagesStore((s) => s.setLibraries)
  const setLoading = usePackagesStore((s) => s.setLoading)
  const setError = usePackagesStore((s) => s.setError)
  const setSearchQuery = usePackagesStore((s) => s.setSearchQuery)
  const toggleOpen = usePackagesStore((s) => s.toggleOpen)

  const addConsoleEntry = useSessionStore((s) => s.addConsoleEntry)
  const addInputHistory = useSessionStore((s) => s.addInputHistory)

  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  const [installOpen, setInstallOpen] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [addLibOpen, setAddLibOpen] = useState(false)

  type ContextMenuState = { name: string; libPath: string; x: number; y: number } | null
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  type VersionConfirmState = { name: string; libPath: string; installedVer: string } | null
  const [versionConfirm, setVersionConfirm] = useState<VersionConfirmState>(null)

  const fetchPackages = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await rClient.listPackages()
      if (res.success) {
        setLibraries(res.libraries)
      } else {
        setError('Failed to fetch packages')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch packages')
    } finally {
      setLoading(false)
    }
  }, [setLibraries, setLoading, setError])

  // Wait for R. This panel used to be mounted only by a user clicking its
  // toolbar button, by which time R had long since connected; now the layout
  // restores whatever was open at the last exit, so it can mount during
  // startup and the first fetch would fail with "R client not initialized".
  const rStatus = useSessionStore((s) => s.rStatus)
  useEffect(() => {
    if (rStatus === 'ready' && libraries.length === 0) {
      fetchPackages()
    }
  }, [rStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const dismiss = () => setContextMenu(null)
    document.addEventListener('click', dismiss)
    document.addEventListener('contextmenu', dismiss)
    return () => {
      document.removeEventListener('click', dismiss)
      document.removeEventListener('contextmenu', dismiss)
    }
  }, [contextMenu])

  const doUpdate = useCallback(async (name: string, libPath: string) => {
    const code = `install.packages("${name}", repos = "https://cran.r-project.org", lib = "${libPath}")`
    addConsoleEntry('input', code)
    addInputHistory(code)
    await rClient.installPackage(code)
    fetchPackages()
  }, [addConsoleEntry, addInputHistory, fetchPackages])

  const handleContextUpdate = useCallback(async (name: string, libPath: string) => {
    setContextMenu(null)
    try {
      const check = await rClient.checkPackageVersion(name, libPath)
      if (check.upToDate) {
        setVersionConfirm({ name, libPath, installedVer: check.installed ?? '' })
        return
      }
    } catch {
      // R error — proceed anyway
    }
    await doUpdate(name, libPath)
  }, [doUpdate])

  const handleContextRemove = useCallback(async (name: string, libPath: string) => {
    setContextMenu(null)
    const code = `remove.packages("${name}", lib = "${libPath}")`
    addConsoleEntry('input', code)
    addInputHistory(code)
    await rClient.installPackage(code)
    fetchPackages()
  }, [addConsoleEntry, addInputHistory, fetchPackages])

  const toggleCollapse = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const query = searchQuery.toLowerCase()

  const filteredLibraries = libraries
    .map((lib) => ({
      ...lib,
      packages: lib.packages.filter((pkg) => pkg.name.toLowerCase().includes(query))
    }))
    .filter((lib) => lib.packages.length > 0)

  return (
    <div className="flex-1 min-h-0 bg-geo-panel flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-geo-border flex-shrink-0">
        <span className="text-xs font-semibold text-foreground">Packages</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-geo-muted hover:text-foreground"
            onClick={() => setAddLibOpen(true)}
            title="Add library path"
          >
            <FolderPlus className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-geo-muted hover:text-foreground"
            onClick={() => setInstallOpen(true)}
            title="Install package"
          >
            <Download className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-geo-muted hover:text-foreground"
            onClick={() => setUpdateOpen(true)}
            title="Update packages"
          >
            <ArrowUpToLine className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-geo-muted hover:text-foreground"
            onClick={fetchPackages}
            title="Refresh packages"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-geo-muted hover:text-foreground"
            onClick={toggleOpen}
            title="Close panel"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-1.5 border-b border-geo-border flex-shrink-0">
        <div className="flex items-center gap-1.5 bg-geo-bg rounded px-2 py-1">
          <Search className="w-3 h-3 text-geo-muted flex-shrink-0" />
          <input
            type="text"
            placeholder="Search packages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-xs text-foreground placeholder:text-geo-muted outline-none w-full"
          />
        </div>
      </div>

      {/* Content */}
      {isLoading && libraries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-geo-muted animate-spin" />
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-3">
          <span className="text-xs text-geo-error text-center">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-geo-accent"
            onClick={fetchPackages}
          >
            Retry
          </Button>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          {filteredLibraries.map((lib) => {
            const isCollapsed = collapsedPaths.has(lib.path)
            return (
              <div key={lib.path}>
                <button
                  className="flex items-center gap-1 w-full px-2 py-1 hover:bg-geo-bg/50 text-left"
                  onClick={() => toggleCollapse(lib.path)}
                  title={lib.path}
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-3 h-3 text-geo-muted flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-3 h-3 text-geo-muted flex-shrink-0" />
                  )}
                  <span className="text-[10px] text-geo-muted truncate">{lib.path}</span>
                </button>
                {!isCollapsed &&
                  lib.packages.map((pkg) => (
                    <PackageItem
                      key={pkg.name}
                      name={pkg.name}
                      version={pkg.version}
                      loaded={pkg.loaded}
                      isBase={pkg.isBase}
                      libPath={lib.path}
                      onContextMenu={(n, lp, x, y) => setContextMenu({ name: n, libPath: lp, x, y })}
                    />
                  ))}
              </div>
            )
          })}
        </ScrollArea>
      )}
      {/* Right-click context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-geo-panel border border-geo-border rounded shadow-lg py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-geo-bg/50"
            onClick={() => handleContextUpdate(contextMenu.name, contextMenu.libPath)}
          >
            Update package
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-geo-error hover:bg-geo-bg/50"
            onClick={() => handleContextRemove(contextMenu.name, contextMenu.libPath)}
          >
            Remove package
          </button>
        </div>
      )}

      {versionConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-geo-panel border border-geo-border rounded-md shadow-xl p-4 w-72 space-y-3">
            <p className="text-sm font-semibold text-foreground">Already up to date</p>
            <p className="text-xs text-geo-muted leading-relaxed">
              <span className="text-foreground font-medium">{versionConfirm.name}</span>
              {versionConfirm.installedVer ? ` ${versionConfirm.installedVer}` : ''} is already the latest CRAN version. Update anyway?
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setVersionConfirm(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="text-xs bg-geo-accent hover:bg-geo-accent/90 text-white"
                onClick={() => { setVersionConfirm(null); doUpdate(versionConfirm.name, versionConfirm.libPath) }}
              >
                Update anyway
              </Button>
            </div>
          </div>
        </div>
      )}

      <InstallPackageDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        onInstalled={fetchPackages}
        libraries={libraries}
      />
      <UpdatePackagesDialog
        open={updateOpen}
        onOpenChange={setUpdateOpen}
        onUpdated={fetchPackages}
        libraries={libraries}
      />
      <AddLibraryDialog
        open={addLibOpen}
        onOpenChange={setAddLibOpen}
        onAdded={fetchPackages}
      />
    </div>
  )
}
