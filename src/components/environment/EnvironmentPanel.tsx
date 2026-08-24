import React, { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Search, X, Loader2, Plus, Save, FolderOpen, Eye } from 'lucide-react'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { EnvironmentGroup } from './EnvironmentGroup'
import { useEnvironmentStore } from '@/store/environment'
import { useSessionStore } from '@/store/session'
import { rClient } from '@/lib/r-client'
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

  const [showNewEnv, setShowNewEnv] = useState(false)
  const [newEnvName, setNewEnvName] = useState('')
  const [saveDropdown, setSaveDropdown] = useState(false)
  const [saveSelection, setSaveSelection] = useState<Set<string>>(new Set())
  const [loadDropdown, setLoadDropdown] = useState(false)

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

  useEffect(() => {
    if (environments.length === 0) {
      fetchEnvironments()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const logToConsole = (cmd: string) => {
    useSessionStore.getState().addConsoleEntry('input', cmd)
  }

  const handleCreateEnv = async () => {
    const name = newEnvName.trim()
    if (!name) return
    logToConsole(`${name} <- new.env(parent = .GlobalEnv)`)
    await rClient.envCreate(name)
    setShowNewEnv(false)
    setNewEnvName('')
    fetchEnvironments()
  }

  const toggleSaveSelection = (envName: string) => {
    setSaveSelection((prev) => {
      const next = new Set(prev)
      if (next.has(envName)) next.delete(envName)
      else next.add(envName)
      return next
    })
  }

  const handleSave = async () => {
    const selected = Array.from(saveSelection)
    if (selected.length === 0) return
    setSaveDropdown(false)
    const filePath = await window.electronAPI.dialog.saveRData()
    if (!filePath) return
    const rdataNames = [...new Set(selected.flatMap(en => rdataLoadedNames[en] ?? []))]
    const envList = selected.join(', ')
    logToConsole(`# Save environments: ${envList} → "${filePath}"`)
    await rClient.envSave(selected, filePath, rdataNames)
    setSaveSelection(new Set())
  }

  const handleLoad = async (envName: string) => {
    setLoadDropdown(false)
    const filePath = await window.electronAPI.dialog.openRData()
    if (!filePath) return
    logToConsole(`load("${filePath}", envir = ${envName})`)
    const result = await rClient.envLoad(filePath, envName)
    if (result.rdataLoadedNames?.length) {
      addRdataLoadedNames(envName, result.rdataLoadedNames)
    }
    fetchEnvironments()
  }

  // Writable envs for load dropdown (.GlobalEnv + custom envs)
  const writableEnvs = environments.filter(
    (e) => e.name === '.GlobalEnv' || !e.name.startsWith('package:')
  )
  // All envs available for saving (including package environments)
  const saveableEnvs = environments

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
              if (!saveDropdown) {
                setSaveSelection(new Set())
              }
              setSaveDropdown(!saveDropdown)
              setLoadDropdown(false)
            }}
            title="Save .RData"
          >
            <Save className="w-3 h-3" />
            Save
          </Button>
          {saveDropdown && (
            <div className="absolute top-full left-0 z-50 bg-geo-panel border border-geo-border rounded shadow-lg py-1 min-w-[160px]">
              <div className="px-3 py-1 text-[10px] text-geo-muted border-b border-geo-border">
                Select environments to save
              </div>
              {saveableEnvs.map((e) => (
                <label
                  key={e.name}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-geo-bg/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={saveSelection.has(e.name)}
                    onChange={() => toggleSaveSelection(e.name)}
                    className="accent-geo-accent w-3 h-3"
                  />
                  {e.name}
                </label>
              ))}
              <div className="border-t border-geo-border px-3 py-1.5 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-2 text-[10px] text-geo-accent hover:text-foreground"
                  disabled={saveSelection.size === 0}
                  onClick={handleSave}
                >
                  Save ({saveSelection.size})
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
              setSaveDropdown(false)
            }}
            title="Load .RData"
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
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-geo-border flex-shrink-0">
          <input
            autoFocus
            className="bg-geo-bg border border-geo-border rounded px-1.5 py-0.5 text-xs text-foreground outline-none flex-1 min-w-0"
            placeholder="Environment name..."
            value={newEnvName}
            onChange={(e) => setNewEnvName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateEnv()
              if (e.key === 'Escape') {
                setShowNewEnv(false)
                setNewEnvName('')
              }
            }}
            onBlur={() => {
              setShowNewEnv(false)
              setNewEnvName('')
            }}
          />
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
          {(userFilterActive
            ? environments
                .filter(env => !env.isSearchPath)
                .map(env => {
                  const rdataSet = new Set(rdataLoadedNames[env.name] ?? [])
                  return rdataSet.size === 0
                    ? env
                    : { ...env, objects: env.objects.filter(obj => !rdataSet.has(obj.name)) }
                })
            : environments
          ).map((env) => (
            <EnvironmentGroup
              key={env.name}
              env={env}
              allEnvironments={environments}
              searchQuery={searchQuery}
              onRefresh={fetchEnvironments}
              defaultExpanded={env.name === '.GlobalEnv'}
            />
          ))}
        </ScrollArea>
      )}
    </div>
  )
}
