import React, { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Search, X, Loader2, Plus, Download, FolderOpen, Eye } from 'lucide-react'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { EnvironmentGroup } from './EnvironmentGroup'
import { useEnvironmentStore } from '@/store/environment'
import { useSessionStore } from '@/store/session'
import { rClient } from '@/lib/r-client'
import {
  exportedNames, loadTargets, panelEnvironments, treeEnvironments, userOnlyView, GLOBAL_ENV,
} from '@/lib/environments'
import { exportEnvironments } from '@/lib/env-export'
import { cn } from '@/lib/utils'

export function EnvironmentPanel(): React.ReactElement {
  const { environments, isLoading, error, searchQuery } = useEnvironmentStore()
  const setEnvironments = useEnvironmentStore((s) => s.setEnvironments)
  const setLoading = useEnvironmentStore((s) => s.setLoading)
  const setError = useEnvironmentStore((s) => s.setError)
  const setSearchQuery = useEnvironmentStore((s) => s.setSearchQuery)
  const toggleOpen = useEnvironmentStore((s) => s.toggleOpen)
  const userFilterActive = useEnvironmentStore((s) => s.userFilterActive)
  const setUserFilterActive = useEnvironmentStore((s) => s.setUserFilterActive)
  const rdataLoadedNames = useEnvironmentStore((s) => s.rdataLoadedNames)
  const addRdataLoadedNames = useEnvironmentStore((s) => s.addRdataLoadedNames)
  const systemNames = useEnvironmentStore((s) => s.systemNames)
  const envPlacement = useEnvironmentStore((s) => s.envPlacement)

  const [showNewEnv, setShowNewEnv] = useState(false)
  const [newEnvName, setNewEnvName] = useState('')
  const [exportDropdown, setExportDropdown] = useState(false)
  const [exportSelection, setExportSelection] = useState<Set<string>>(new Set())
  const [loadDropdown, setLoadDropdown] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const fetchEnvironments = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await rClient.listEnvironments()
      if (res.success) {
        setEnvironments(res.environments)
      } else {
        setError('Failed to fetch environments')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch environments')
    } finally {
      setLoading(false)
    }
  }, [setEnvironments, setLoading, setError])

  // Wait for R. This panel used to be mounted only by a user clicking its
  // toolbar button, by which time R had long since connected; now the layout
  // restores whatever was open at the last exit, so it can mount during
  // startup and the first fetch would fail with "R client not initialized".
  const rStatus = useSessionStore((s) => s.rStatus)
  useEffect(() => {
    if (rStatus === 'ready' && environments.length === 0) {
      fetchEnvironments()
    }
  }, [rStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  const logToConsole = (cmd: string) => {
    useSessionStore.getState().addConsoleEntry('input', cmd)
  }

  const handleCreateEnv = async () => {
    const name = newEnvName.trim()
    if (!name) return
    // The server refuses a name that is not a syntactic R name, and one that
    // is already taken — silently overwriting is how a user loses a data frame
    // by naming an environment after it. Keep the input open so the name can
    // be fixed where it was typed.
    const res = await rClient.envCreate(name)
    if (!res.success) {
      setCreateError(res.error ?? 'Could not create that environment.')
      return
    }
    // Every environment ouRGeo makes is `new.env(parent = .GlobalEnv)` — a
    // child of the global environment, which is what makes .GlobalEnv visible
    // from inside it. There is no second kind worth offering: the only other
    // sensible parent is `emptyenv()`, where even `*` cannot be found.
    logToConsole(`${name} <- new.env(parent = .GlobalEnv)`)
    // R looks names up outwards, never into an environment, so `x` put in here
    // is not `x` at the prompt. Said at the moment the environment is made,
    // because the alternative is finding out later through an error.
    logToConsole(`# Objects in ${name} are ${name}$x — reach them with ${name}$x or with(${name}, x * a),`)
    logToConsole(`# or right-click ${name} → "Work in this environment" and just type x * a`)
    setShowNewEnv(false)
    setNewEnvName('')
    setCreateError(null)
    fetchEnvironments()
  }

  const toggleExportSelection = (envName: string) => {
    setExportSelection((prev) => {
      const next = new Set(prev)
      if (next.has(envName)) next.delete(envName)
      else next.add(envName)
      return next
    })
  }

  const handleExport = async (envNames: string[]) => {
    setExportDropdown(false)
    await exportEnvironments(envNames)
    setExportSelection(new Set())
  }

  const handleLoad = async (envName: string) => {
    setLoadDropdown(false)
    const filePath = await window.electronAPI.dialog.openRData()
    if (!filePath) return
    logToConsole(`load("${filePath}", envir = ${envName})`)
    const result = await rClient.envLoad(filePath, envName)
    if (!result.success) {
      useSessionStore.getState().addConsoleEntry('error', result.error ?? 'Load failed')
      return
    }
    if (result.rdataLoadedNames?.length) {
      addRdataLoadedNames(envName, result.rdataLoadedNames)
    }
    fetchEnvironments()
  }

  // The panel's own view: the user's environments listed beside .GlobalEnv,
  // and — for the ones the user asked to see both ways — inside it as well.
  // Everything below reads this, not the raw list.
  const panelEnvs = panelEnvironments(environments, envPlacement)
  // One list drives the tree, the Export dropdown, the Load targets and the
  // Move To menus, so the eye means the same thing everywhere: what you can
  // see is what you can act on.
  const visibleEnvs = userFilterActive ? userOnlyView(panelEnvs, rdataLoadedNames) : panelEnvs
  // A .RData can only be loaded somewhere the user keeps objects. This used to
  // be "not a package:" environment, which offered Autoloads.
  const writableEnvs = loadTargets(visibleEnvs)

  return (
    <div className="flex-1 min-h-0 bg-geo-panel flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-geo-border flex-shrink-0">
        <span className="text-xs font-semibold text-foreground">Environment</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-geo-muted hover:text-foreground"
            onClick={fetchEnvironments}
            title="Refresh"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-5 w-5 p-0', !userFilterActive ? 'text-geo-accent' : 'text-geo-muted hover:text-foreground')}
            onClick={() => setUserFilterActive(!userFilterActive)}
            title={userFilterActive ? 'Show non-user objects' : 'Hide non-user objects'}
          >
            <Eye className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-geo-muted hover:text-foreground"
            onClick={() => setShowNewEnv(true)}
            title="New Environment"
          >
            <Plus className="w-3 h-3" />
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
            placeholder="Search objects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-xs text-foreground placeholder:text-geo-muted outline-none w-full"
          />
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-geo-border flex-shrink-0 relative">
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-geo-muted hover:text-foreground gap-1"
            onClick={() => {
              if (!exportDropdown) {
                setExportSelection(new Set())
              }
              setExportDropdown(!exportDropdown)
              setLoadDropdown(false)
            }}
            title="Export environments to an .RData file on your computer"
            data-ourgeo-id="environment.export"
          >
            <Download className="w-3 h-3" />
            Export
          </Button>
          {exportDropdown && (
            <div className="absolute top-full left-0 z-50 bg-geo-panel border border-geo-border rounded shadow-lg py-1 min-w-[180px]">
              <div className="px-3 py-1 text-[10px] text-geo-muted border-b border-geo-border">
                Environments to write to the file
              </div>
              <div className="max-h-56 overflow-y-auto">
                {visibleEnvs.map((e) => (
                  <label
                    key={e.name}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-geo-bg/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={exportSelection.has(e.name)}
                      onChange={() => toggleExportSelection(e.name)}
                      className="accent-geo-accent w-3 h-3"
                    />
                    <span className="truncate">{e.name}</span>
                    <span className="ml-auto text-[10px] text-geo-muted flex-shrink-0">
                      {exportedNames(e, systemNames).length}
                    </span>
                  </label>
                ))}
              </div>
              <div className="border-t border-geo-border px-3 py-1.5 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-2 text-[10px] text-geo-accent hover:text-foreground"
                  disabled={exportSelection.size === 0}
                  onClick={() => void handleExport(Array.from(exportSelection))}
                >
                  Export ({exportSelection.size})
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-geo-muted hover:text-foreground gap-1"
            onClick={() => {
              setLoadDropdown(!loadDropdown)
              setExportDropdown(false)
            }}
            title="Load an .RData file into an environment"
            data-ourgeo-id="environment.load"
          >
            <FolderOpen className="w-3 h-3" />
            Load
          </Button>
          {loadDropdown && (
            <div className="absolute top-full left-0 z-50 bg-geo-panel border border-geo-border rounded shadow-lg py-1 min-w-[120px]">
              {writableEnvs.map((e) => (
                <button
                  key={e.name}
                  className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-geo-bg/50"
                  onClick={() => handleLoad(e.name)}
                >
                  {e.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* New env inline input */}
      {showNewEnv && (
        <div className="px-3 py-1.5 border-b border-geo-border flex-shrink-0">
          <input
            autoFocus
            className="bg-geo-bg border border-geo-border rounded px-1.5 py-0.5 text-xs text-foreground outline-none w-full"
            placeholder="Environment name..."
            value={newEnvName}
            onChange={(e) => { setNewEnvName(e.target.value); setCreateError(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreateEnv()
              if (e.key === 'Escape') {
                setShowNewEnv(false)
                setNewEnvName('')
                setCreateError(null)
              }
            }}
            // No onBlur close: the refusal below is worth reading, and a
            // blur-to-cancel takes the typed name away with it the moment the
            // user reaches for anything else.
          />
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('text-[10px] flex-1 min-w-0', createError ? 'text-geo-error' : 'text-geo-muted')}>
              {createError ?? 'Created in .GlobalEnv and listed beside it; its objects are name$object.'}
            </span>
            <button
              className="text-[10px] text-geo-muted hover:text-foreground flex-shrink-0"
              onClick={() => { setShowNewEnv(false); setNewEnvName(''); setCreateError(null) }}
            >
              Cancel
            </button>
            <button
              className="text-[10px] text-geo-accent hover:text-foreground flex-shrink-0 disabled:opacity-40"
              disabled={newEnvName.trim().length === 0}
              onClick={() => void handleCreateEnv()}
            >
              Create
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading && environments.length === 0 ? (
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
            onClick={fetchEnvironments}
          >
            Retry
          </Button>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          {treeEnvironments(visibleEnvs).map((env) => (
            <EnvironmentGroup
              key={env.name}
              env={env}
              allEnvironments={visibleEnvs}
              searchQuery={searchQuery}
              onRefresh={fetchEnvironments}
              defaultExpanded={env.name === GLOBAL_ENV}
            />
          ))}
        </ScrollArea>
      )}
    </div>
  )
}
