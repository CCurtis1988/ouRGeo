import { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent } from 'react'
import { X, ChevronRight, Search } from 'lucide-react'
import { categoryList } from './tools'
import { useEnvironmentStore } from '@/store/environment'
import { usePluginRevision } from '@/store/plugins'
import { rClient } from '@/lib/r-client'
import type { REnvironmentInfo } from '@/lib/r-client'
import { ToolForm } from './toolboxBuilders'
import { predictColumns, type PipelineStep, type PipelineState } from './toolboxPipeline'

interface ToolboxDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ToolboxDialog({ open, onOpenChange }: ToolboxDialogProps) {
  // Read per render rather than at module load: a plugin can add a tool while
  // the app is running, and a list captured once would never show it.
  // `usePluginRevision` is the subscription that gets us re-rendered at all;
  // `categoryList()` then returns a fresh array, which is what invalidates the
  // memo below. Neither alone is enough.
  usePluginRevision()
  const categories = categoryList()
  const allTools = useMemo(
    () => categories.flatMap(c => c.tools.map(t => ({ ...t, categoryLabel: c.label, categoryId: c.id }))),
    [categories],
  )
  const [selectedToolId, setSelectedToolId] = useState<string>(categories[0].tools[0].id)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(categories.map(c => c.id))
  )
  const [environments, setEnvironments] = useState<REnvironmentInfo[]>([])
  const storeEnvs = useEnvironmentStore(s => s.environments)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHighlighted, setSearchHighlighted] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchDropdownRef = useRef<HTMLDivElement>(null)

  // Pipeline state
  const [pipeline, setPipeline] = useState<PipelineState | null>(null)

  // Predicted column list for the next tool — derived purely client-side, no R execution
  const pipelineColumns = useMemo(
    () => pipeline ? predictColumns(pipeline.steps, pipeline.baseColumns) : [],
    [pipeline]
  )

  function selectTool(toolId: string) {
    setSelectedToolId(toolId)
  }

  async function handlePipe(step: PipelineStep, dsName: string) {
    const newSteps = [...(pipeline?.steps ?? []), step]
    const initialDs = pipeline?.initialDs ?? dsName
    const finalOutputName = pipeline?.finalOutputName ?? step.outputName

    let baseColumns = pipeline?.baseColumns ?? []
    if (!pipeline) {
      // First step: fetch the initial dataset's actual columns from R once
      const env = environments.find(e => !e.isSearchPath && e.objects.some(o => o.name === initialDs))
      if (env) {
        try {
          const res = await rClient.getObjectDataFrame(initialDs, env.name, initialDs, 0, 0)
          if (res.success && res.columns) baseColumns = res.columns
        } catch {}
      }
    }

    setPipeline({ steps: newSteps, initialDs, baseColumns, finalOutputName })
  }

  function clearPipeline() {
    setPipeline(null)
  }

  // Sync with store and refresh on open
  const fetchEnvironments = useCallback(async () => {
    try {
      const res = await rClient.listEnvironments()
      if (res.success) {
        useEnvironmentStore.getState().setEnvironments(res.environments)
        setEnvironments(res.environments)
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (open) {
      // Use cached store data immediately, then refresh
      setEnvironments(storeEnvs)
      fetchEnvironments()
      setSearchQuery('')
      setSearchOpen(false)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close search dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        searchRef.current && !searchRef.current.contains(e.target as Node) &&
        searchDropdownRef.current && !searchDropdownRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const searchResults = searchQuery.trim()
    ? allTools.filter(t => t.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : []

  useEffect(() => { setSearchHighlighted(0) }, [searchQuery])

  function selectSearchResult(toolId: string) {
    selectTool(toolId)
    setSearchQuery('')
    setSearchOpen(false)
    // Expand the category that contains this tool
    const tool = allTools.find(t => t.id === toolId)
    if (tool) {
      setExpandedCategories(prev => {
        const next = new Set(prev)
        next.add(tool.categoryId)
        return next
      })
    }
  }

  function handleSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!searchOpen || searchResults.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSearchHighlighted(h => Math.min(h + 1, searchResults.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchHighlighted(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      if (searchResults[searchHighlighted]) {
        selectSearchResult(searchResults[searchHighlighted].id)
        e.preventDefault()
      }
    } else if (e.key === 'Escape') {
      setSearchOpen(false)
      setSearchQuery('')
    }
  }

  const selectedTool = allTools.find(t => t.id === selectedToolId)!

  function toggleCategory(id: string) {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="bg-[#161b22] border border-[#21262d] rounded-lg shadow-2xl flex flex-col"
        style={{ width: 860, height: '90vh', maxHeight: 700 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#21262d]">
          <h1 className="text-sm font-semibold text-white">Toolbox</h1>
          <button
            className="text-[#8b949e] hover:text-white transition-colors"
            onClick={() => onOpenChange(false)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left sidebar — categories + tools */}
          <div className="w-48 flex-shrink-0 border-r border-[#21262d] flex flex-col">
            {/* Search bar */}
            <div className="relative px-2 pt-2 pb-1 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#8b949e] pointer-events-none" />
                <input
                  ref={searchRef}
                  className="w-full bg-[#0f1117] border border-[#21262d] rounded pl-6 pr-2 py-1 text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-[#4493f8]"
                  placeholder="Search tools…"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true) }}
                  onFocus={() => { if (searchQuery) setSearchOpen(true) }}
                  onKeyDown={handleSearchKey}
                />
              </div>
              {searchOpen && searchResults.length > 0 && (
                <div
                  ref={searchDropdownRef}
                  className="absolute z-50 left-2 right-2 mt-1 bg-[#161b22] border border-[#21262d] rounded shadow-lg max-h-64 overflow-y-auto"
                >
                  {searchResults.map((tool, i) => (
                    <div
                      key={tool.id}
                      className={`px-2 py-1.5 cursor-pointer ${i === searchHighlighted ? 'bg-[#4493f8]/20 text-white' : 'text-[#e6edf3] hover:bg-[#21262d]'}`}
                      onMouseDown={() => selectSearchResult(tool.id)}
                      onMouseEnter={() => setSearchHighlighted(i)}
                    >
                      <div className="text-xs">{tool.label}</div>
                      <div className="text-[10px] text-[#8b949e]">{tool.categoryLabel}</div>
                    </div>
                  ))}
                </div>
              )}
              {searchOpen && searchQuery.trim() && searchResults.length === 0 && (
                <div
                  ref={searchDropdownRef}
                  className="absolute z-50 left-2 right-2 mt-1 bg-[#161b22] border border-[#21262d] rounded shadow-lg px-2 py-2 text-xs text-[#8b949e]"
                >
                  No tools found
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto py-1">
            {categories.map(cat => (
              <div key={cat.id}>
                <button
                  className="w-full flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#8b949e] hover:text-white transition-colors"
                  onClick={() => toggleCategory(cat.id)}
                >
                  <ChevronRight
                    className={`w-3 h-3 transition-transform ${expandedCategories.has(cat.id) ? 'rotate-90' : ''}`}
                  />
                  {cat.label}
                </button>
                {expandedCategories.has(cat.id) && (
                  <div>
                    {cat.tools.map(tool => (
                      <button
                        key={tool.id}
                        className={`w-full text-left pl-7 pr-3 py-1 text-xs transition-colors ${
                          selectedToolId === tool.id
                            ? 'bg-[#4493f8]/15 text-white'
                            : 'text-[#8b949e] hover:text-white hover:bg-[#21262d]/50'
                        }`}
                        onClick={() => selectTool(tool.id)}
                      >
                        {tool.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            </div>
          </div>

          {/* Right panel — pipeline banner + tool form */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0">
            {/* Pipeline banner */}
            {pipeline && (
              <div className="px-4 pt-3 pb-2 border-b border-[#21262d] flex items-center gap-2 flex-shrink-0">
                <div className="flex-1 flex items-center gap-1 text-[10px] overflow-hidden flex-wrap">
                  <span className="text-[#4493f8] font-medium font-mono">{pipeline.initialDs}</span>
                  {pipeline.steps.map((s, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <span className="text-[#8b949e]">|&gt;</span>
                      <span className="text-[#e6edf3] truncate max-w-[120px]" title={s.pipeStep}>{s.toolLabel}</span>
                    </span>
                  ))}
                  <span className="text-[#8b949e]">|&gt;</span>
                  <span className="text-[#4493f8] font-medium">{selectedTool.label}</span>
                </div>
                <button
                  className="flex-shrink-0 text-[#8b949e] hover:text-[#f85149] transition-colors"
                  title="Clear pipeline"
                  onClick={clearPipeline}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-4">
              <ToolForm
                key={selectedToolId}
                tool={selectedTool}
                environments={environments}
                pipelineDs={pipeline?.initialDs}
                pipeline={pipeline ?? undefined}
                pipelineColumns={pipelineColumns.length > 0 ? pipelineColumns : undefined}
                onPipe={handlePipe}
                onClearPipeline={clearPipeline}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
