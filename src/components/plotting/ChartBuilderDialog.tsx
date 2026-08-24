import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Copy, Check, Play, Loader2, Plus } from 'lucide-react'
import { Button } from '../ui/button'
import { rClient, type ColumnInfo, type REnvironmentInfo } from '@/lib/r-client'
import { useEnvironmentStore } from '@/store/environment'
import { useSessionStore } from '@/store/session'
import { DatasetCombobox } from '@/components/ui/DatasetCombobox'
import {
  DEFAULT_AES, newLayer, makeDefaultState, getConflictingLayerIds, geomAvailability, buildGgplotCode,
  type VarType, type AesMap, type CustomizeState, type LabelsState, type ThemeState,
  type ChartBuilderState, type AesKey,
} from './chartBuilderModel'
import {
  AestheticSlot, VarChip, SectionHead, LabelsTab, ThemeTab, GeomLayerAccordion,
} from './chartBuilderControls'

type Tab = 'aesthetics' | 'labels' | 'theme'

// ── Main dialog ────────────────────────────────────────────────────────────────

interface Props { open: boolean; onOpenChange: (open: boolean) => void }

export function ChartBuilderDialog({ open, onOpenChange }: Props): React.ReactElement {
  const [state, setState] = useState<ChartBuilderState>(makeDefaultState)
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [colSearch, setColSearch] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<Tab>('aesthetics')
  const [draggingType, setDraggingType] = useState<VarType | null>(null)
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null)

  const storeEnvs = useEnvironmentStore(s => s.environments)
  const [environments, setEnvironments] = useState<REnvironmentInfo[]>([])
  const addEntry = useSessionStore(s => s.addConsoleEntry)

  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const colCache = useRef<Map<string, ColumnInfo[]>>(new Map())

  useEffect(() => { setEnvironments(storeEnvs) }, [storeEnvs])

  useEffect(() => {
    if (!open) return
    const ds = makeDefaultState()
    setState(ds)
    setExpandedLayerId(ds.layers[0].id)
    setColumns([])
    setColSearch('')
    setPreviewUrl(null)
    setPreviewError(null)
    setTab('aesthetics')
    rClient.listEnvironments().then(res => {
      if (res.success) {
        useEnvironmentStore.getState().setEnvironments(res.environments)
        setEnvironments(res.environments)
      }
    }).catch(() => {})
  }, [open])

  // Fetch columns when dataset changes
  useEffect(() => {
    if (!state.dataset) { setColumns([]); return }
    if (colCache.current.has(state.dataset)) {
      setColumns(colCache.current.get(state.dataset)!)
      return
    }
    const env = environments.find(e => !e.isSearchPath && e.objects.some(o => o.name === state.dataset))
    const envName = env?.name ?? '.GlobalEnv'
    rClient.getObjectDataFrame(state.dataset, envName, state.dataset, 0, 0).then(res => {
      if (res.success && res.columns) {
        colCache.current.set(state.dataset, res.columns)
        setColumns(res.columns)
      }
    }).catch(() => {})
  }, [state.dataset, environments])

  // Debounced preview
  const schedulePreview = useCallback((s: ChartBuilderState) => {
    const code = buildGgplotCode(s)
    if (!code) { setPreviewUrl(null); setPreviewError(null); return }
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(async () => {
      setPreviewLoading(true)
      setPreviewError(null)
      const res = await rClient.renderPlotPreview(code)
      setPreviewLoading(false)
      if (res.success && res.data) { setPreviewUrl(res.data); setPreviewError(null) }
      else { setPreviewError(res.error ?? 'Unknown error') }
    }, 600)
  }, [])

  function update(patch: Partial<ChartBuilderState>) {
    setState(prev => {
      const next = { ...prev, ...patch }
      schedulePreview(next)
      return next
    })
  }
  function updateAes(patch: Partial<AesMap>) {
    setState(prev => {
      const next = { ...prev, aes: { ...prev.aes, ...patch } }
      schedulePreview(next)
      return next
    })
  }
  function updateLabels(patch: Partial<LabelsState>) {
    setState(prev => {
      const next = { ...prev, labels: { ...prev.labels, ...patch } }
      schedulePreview(next)
      return next
    })
  }
  function updateTheme(patch: Partial<ThemeState>) {
    setState(prev => {
      const next = { ...prev, theme: { ...prev.theme, ...patch } }
      schedulePreview(next)
      return next
    })
  }

  // ── Layer management ──

  function addLayer() {
    if (state.layers.length >= 4) return
    const layer = newLayer('point')
    setState(prev => {
      const next = { ...prev, layers: [...prev.layers, layer] }
      schedulePreview(next)
      return next
    })
    setExpandedLayerId(layer.id)
  }

  function updateLayerGeom(id: string, geomType: string) {
    setState(prev => {
      const next = { ...prev, layers: prev.layers.map(l => l.id === id ? { ...l, geomType } : l) }
      schedulePreview(next)
      return next
    })
  }

  function updateLayerCustomize(id: string, patch: Partial<CustomizeState>) {
    setState(prev => {
      const next = {
        ...prev,
        layers: prev.layers.map(l => l.id === id ? { ...l, customize: { ...l.customize, ...patch } } : l),
      }
      schedulePreview(next)
      return next
    })
  }

  function toggleLayerVisible(id: string) {
    setState(prev => {
      const next = { ...prev, layers: prev.layers.map(l => l.id === id ? { ...l, visible: !l.visible } : l) }
      schedulePreview(next)
      return next
    })
  }

  function deleteLayer(id: string) {
    if (state.layers.length <= 1) return
    setState(prev => {
      const next = { ...prev, layers: prev.layers.filter(l => l.id !== id) }
      schedulePreview(next)
      return next
    })
    if (expandedLayerId === id) setExpandedLayerId(null)
  }

  function assignAes(key: AesKey, colName: string) { updateAes({ [key]: colName }) }

  function clickAssign(colName: string) {
    const a = state.aes
    const emptySlot = (['x', 'y', 'colour', 'fill', 'size'] as AesKey[]).find(k => !a[k])
    if (emptySlot) updateAes({ [emptySlot]: colName })
  }

  const code = buildGgplotCode(state)
  const availability = geomAvailability(state.aes, columns)
  const conflictIds = getConflictingLayerIds(state.layers, state.aes.y)
  const filteredCols = columns.filter(c =>
    !colSearch || c.name.toLowerCase().includes(colSearch.toLowerCase())
  )
  const canAddLayer = state.layers.length < 4

  async function handleRun() {
    if (!code) return
    addEntry('input', code)
    await rClient.execute(code)
    onOpenChange(false)
  }
  async function handleCopy() {
    if (!code) return
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const AES_SLOTS: AesKey[] = ['x', 'y', 'colour', 'fill', 'size', 'shape', 'alpha', 'group', 'facetRow', 'facetCol']

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 flex flex-col bg-[#161b22] border border-[#21262d] rounded-lg shadow-2xl overflow-hidden"
          style={{ width: '92vw', maxWidth: 1200, height: '90vh' }}
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#21262d] flex-shrink-0">
            <Dialog.Title className="text-sm font-semibold text-white">Create Chart</Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-[#8b949e] hover:text-white transition-colors"><X className="w-4 h-4" /></button>
            </Dialog.Close>
          </div>

          {/* ── Body ── */}
          <div className="flex flex-1 min-h-0">

            {/* ── Left: Variables ── */}
            <div className="w-48 flex-shrink-0 border-r border-[#21262d] flex flex-col">
              <div className="px-3 py-2 border-b border-[#21262d] flex-shrink-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8b949e] mb-1.5">Dataset</div>
                <DatasetCombobox
                  value={state.dataset}
                  onChange={v => update({ dataset: v, aes: DEFAULT_AES })}
                  environments={environments}
                  inputClassName="w-full bg-[#0f1117] border border-[#21262d] rounded px-2 py-1.5 text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-[#4493f8]"
                  dropdownClassName="absolute z-[70] mt-1 w-full bg-[#161b22] border border-[#21262d] rounded shadow-xl max-h-48 overflow-y-auto"
                />
              </div>
              {columns.length > 0 && (
                <div className="px-3 py-2 border-b border-[#21262d] flex-shrink-0">
                  <input
                    className="w-full bg-[#0f1117] border border-[#21262d] rounded px-2 py-1 text-[10px] text-white placeholder-[#8b949e] focus:outline-none focus:border-[#4493f8]"
                    value={colSearch} onChange={e => setColSearch(e.target.value)} placeholder="Filter variables…"
                  />
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {!state.dataset && (
                  <p className="text-[10px] text-[#8b949e] text-center mt-4 px-2">Select a dataset to see variables</p>
                )}
                {filteredCols.map(col => (
                  <VarChip key={col.name} col={col} onClick={() => clickAssign(col.name)}
                    onDragStart={vt => setDraggingType(vt)}
                    onDragEnd={() => setDraggingType(null)} />
                ))}
              </div>
              <div className="px-3 py-2 border-t border-[#21262d] flex-shrink-0">
                <p className="text-[9px] text-[#8b949e]/60 leading-relaxed">Drag variables onto aesthetic slots →</p>
              </div>
            </div>

            {/* ── Center: Config tabs ── */}
            <div className="flex-1 flex flex-col min-w-0 border-r border-[#21262d]">
              {/* Tab bar */}
              <div className="flex border-b border-[#21262d] flex-shrink-0 bg-[#0f1117]/40">
                {(['aesthetics', 'labels', 'theme'] as Tab[]).map(t => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`px-4 py-2.5 text-xs font-medium capitalize transition-colors ${
                      tab === t
                        ? 'text-white border-b-2 border-[#4493f8] -mb-px bg-[#161b22]'
                        : 'text-[#8b949e] hover:text-white'
                    }`}>{t}</button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {/* ── Aesthetics tab ── */}
                {tab === 'aesthetics' && (
                  <>
                    <SectionHead title="Aesthetic Mappings" />
                    <div className="space-y-1.5 mb-4">
                      {AES_SLOTS.map(key => (
                        <AestheticSlot
                          key={key} aesKey={key}
                          value={state.aes[key]}
                          draggingType={draggingType}
                          onAssign={assignAes}
                          columns={columns}
                        />
                      ))}
                    </div>

                    <SectionHead title="Layers" />
                    <GeomLayerAccordion
                      layers={state.layers}
                      expandedId={expandedLayerId}
                      conflictIds={conflictIds}
                      aes={state.aes}
                      columns={columns}
                      availability={availability}
                      onExpand={setExpandedLayerId}
                      onUpdateGeom={updateLayerGeom}
                      onUpdateCustomize={updateLayerCustomize}
                      onToggleVisible={toggleLayerVisible}
                      onDelete={deleteLayer}
                    />

                    <button
                      onClick={addLayer}
                      disabled={!canAddLayer}
                      className={`mt-3 w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-dashed text-xs transition-colors ${
                        canAddLayer
                          ? 'border-[#21262d] text-[#8b949e] hover:border-[#4493f8]/50 hover:text-white'
                          : 'border-[#21262d]/50 text-[#8b949e]/30 cursor-not-allowed'
                      }`}
                      title={canAddLayer ? 'Add another geom layer (max 4)' : 'Maximum of 4 layers reached'}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {canAddLayer ? 'Add Layer' : 'Max layers reached (4)'}
                    </button>
                  </>
                )}

                {/* ── Labels tab ── */}
                {tab === 'labels' && (
                  <LabelsTab labels={state.labels} aes={state.aes} onChange={updateLabels} />
                )}

                {/* ── Theme tab ── */}
                {tab === 'theme' && (
                  <ThemeTab theme={state.theme} onChange={updateTheme} />
                )}
              </div>
            </div>

            {/* ── Right: Preview + code ── */}
            <div className="w-80 flex-shrink-0 flex flex-col">
              {/* Preview image */}
              <div className="flex-1 min-h-0 m-3 mb-0 bg-[#0f1117] border border-[#21262d] rounded flex items-center justify-center relative overflow-hidden">
                {previewLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#0f1117]/80 z-10">
                    <Loader2 className="w-5 h-5 text-[#4493f8] animate-spin" />
                  </div>
                )}
                {previewError && !previewLoading && (
                  <div className="px-4 py-3 text-center">
                    <p className="text-[10px] font-semibold text-[#f85149] mb-1">Preview error</p>
                    <p className="text-[10px] text-[#8b949e] leading-relaxed">{previewError}</p>
                  </div>
                )}
                {previewUrl && !previewError && (
                  <img src={previewUrl} alt="Chart preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                )}
                {!previewUrl && !previewError && !previewLoading && (
                  <p className="text-[10px] text-[#8b949e] text-center px-4">
                    {!state.dataset ? 'Select a dataset to begin.' : 'Map variables to aesthetics to see a preview.'}
                  </p>
                )}
              </div>

              {/* Generated code */}
              <div className="mx-3 mt-2 flex-shrink-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8b949e] mb-1">Generated Code</div>
                <pre className="bg-[#0f1117] border border-[#21262d] rounded p-2.5 text-[10px] text-[#e6edf3] overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
                  {code || <span className="text-[#8b949e]">Code appears here…</span>}
                </pre>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 p-3 flex-shrink-0">
                <Button variant="ghost" size="sm"
                  className="h-7 px-3 text-xs text-[#8b949e] hover:text-white gap-1.5"
                  onClick={handleCopy} disabled={!code}>
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
                <Button size="sm"
                  className="h-7 px-3 text-xs bg-[#4493f8] hover:bg-[#4493f8]/90 text-white gap-1.5"
                  onClick={handleRun} disabled={!code}>
                  <Play className="w-3.5 h-3.5" />
                  Run &amp; Add to Plots
                </Button>
              </div>
            </div>

          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
