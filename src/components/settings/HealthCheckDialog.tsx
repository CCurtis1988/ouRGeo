import React, { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, HeartPulse, CheckCircle2, AlertCircle, CircleMinus, Loader2, ArrowRight } from 'lucide-react'
import type { HealthHardware, HealthPackage, HealthPackageCopy, HealthReport, HealthResult, InstallPlan, RHealth } from '@/lib/health-types'
import { useUiStore } from '@/store/ui'
import { useAiStore } from '@/store/ai'
import { useApiKeysStore } from '@/store/apiKeys'
import { isLocalProvider, PROVIDER_LABELS } from '@/lib/ai-client'
import { inspectConnections, packageResults, testAssistant } from '@/lib/health-check'
import { reconnectToR } from '@/lib/reconnect-r'
import { rClient } from '@/lib/r-client'
import { saveCurrentProject } from '@/lib/project-persistence'
import { useSessionStore } from '@/store/session'
import { LocalModelSetup } from './LocalModelSetup'
import { loadHealthCheckpoint, saveHealthCheckpoint, clearHealthCheckpoint, type HealthCheckpoint, type HealthStep } from '@/lib/health-checkpoint'

type Step = HealthStep
interface Choice { id: string; label: string; primary?: boolean }
interface Request {
  title: string
  detail: string
  choices: Choice[]
  packages?: HealthPackage[]
  duplicates?: HealthPackageCopy[]
  configure?: boolean
  plan?: InstallPlan
  saveProject?: boolean
  resolve: (answer: { id: string; packages: string[] }) => void
}
const button = 'rounded border border-geo-border px-3 py-2 text-xs font-medium text-foreground hover:bg-geo-bg disabled:opacity-40 disabled:cursor-not-allowed'
const primary = 'rounded bg-geo-accent px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed'
const labels: Record<Step, string> = { welcome: 'Welcome', r: 'R installation', packages: 'R packages', system: 'System', ai: 'AI assistant', summary: 'Results' }
const steps: Step[] = ['r', 'packages', 'system', 'ai', 'summary']
const statusLabel = { pass: 'Ready', warning: 'Needs attention', error: 'Needs repair', skipped: 'Skipped' }
const copyKey = (copy: HealthPackageCopy) => JSON.stringify([copy.name, copy.library])
class GoBack extends Error {}

function ResultRow({ result }: { result: HealthResult }): React.ReactElement {
  const Icon = result.status === 'pass' ? CheckCircle2 : result.status === 'skipped' ? CircleMinus : AlertCircle
  return <div className="flex gap-3 py-3 border-b border-geo-border last:border-0">
    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${result.status === 'pass' ? 'text-geo-success' : result.status === 'error' ? 'text-geo-error' : 'text-geo-muted'}`} />
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium">{result.title}</span><span className="text-[11px] text-geo-muted">{result.repaired ? 'Fixed' : statusLabel[result.status]}</span></div><p className="text-xs text-geo-muted mt-1 leading-relaxed break-words">{result.detail}</p></div>
  </div>
}
export function HealthCheckDialog(): React.ReactElement {
  const open = useUiStore((s) => s.openDialog === 'health-check')
  const [restored] = useState(loadHealthCheckpoint)
  const [initialized, setInitialized] = useState(false)
  const [step, setStep] = useState<Step>(restored?.step ?? 'welcome')
  const [running, setRunning] = useState(restored?.running ?? false)
  const [locked, setLocked] = useState(restored?.locked ?? false)
  const lockRef = useRef(restored?.locked ?? false)
  const dismissedRef = useRef(false)
  const [results, setResults] = useState<HealthResult[]>(restored?.results ?? [])
  const [hardware, setHardware] = useState<HealthHardware | null>(restored?.hardware ?? null)
  const [request, setRequest] = useState<Request | null>(null)
  const requestRef = useRef<Request | null>(null)
  const lastPromptRef = useRef(restored?.pendingTitle ?? null)
  const [selected, setSelected] = useState<string[]>(restored?.selected ?? [])
  const [progress, setProgress] = useState(restored?.progress ?? '')
  const [installLog, setInstallLog] = useState(restored?.installLog ?? '')
  const [report, setReport] = useState<HealthReport | null>(restored?.report ?? null)
  const [notice, setNotice] = useState('')
  const runtimeRef = useRef<RHealth | null>(restored?.runtime ?? null)
  const repairedRef = useRef(restored?.repairedPackages ?? false)
  const startRef = useRef<((saved?: HealthCheckpoint) => Promise<void>) | null>(null)
  const controller = useRef<AbortController | null>(null)
  const api = window.electronAPI?.health

  useEffect(() => {
    if (!api) return
    let cancelled = false
    void api.history().then((history) => {
      if (cancelled || dismissedRef.current) return
      setReport(restored?.report ?? history.report)
      if (restored || (!history.prompted && !useUiStore.getState().openDialog)) useUiStore.getState().showDialog('health-check')
      setInitialized(true)
      if (restored?.running) {
        const ac = new AbortController(); controller.current = ac
        setRunning(true); setBusy(true); setProgress('Restoring the health check…')
        void (async () => {
          try {
            let activity = await api.activity()
            while (activity.busy) {
              ac.signal.throwIfAborted()
              setProgress(activity.progress || 'Waiting for your approved changes to finish…')
              await new Promise((resolve) => setTimeout(resolve, 1000))
              activity = await api.activity()
            }
            ac.signal.throwIfAborted()
            setBusy(false)
            if (activity.error && restored.locked) setNotice(`The previous repair did not finish successfully: ${activity.error}`)
            await startRef.current?.({ ...restored, repairedPackages: activity.needsRRestart })
          } catch (e) {
            if (!ac.signal.aborted) { setNotice(`Could not resume the health check: ${String(e)}`); setRunning(false); setBusy(false) }
          }
        })()
      }
    }).catch(() => { if (!cancelled) { setNotice('Could not read health-check history. You can still run the checks.'); setInitialized(true); if (restored) useUiStore.getState().showDialog('health-check') } })
    return () => { cancelled = true }
  }, [api, restored])
  useEffect(() => () => { controller.current?.abort(); requestRef.current?.resolve({ id: 'stop', packages: [] }) }, [])
  useEffect(() => {
    if (!initialized) return
    if (!open) { clearHealthCheckpoint(); return }
    saveHealthCheckpoint({ version: 1, step, running, locked, atCheckpoint: !!request?.choices.some((choice) => choice.id === 'next'),
      pendingTitle: request?.title ?? lastPromptRef.current, selected, results, hardware, runtime: runtimeRef.current,
      report, progress, installLog, repairedPackages: repairedRef.current })
  }, [initialized, open, step, running, locked, request, selected, results, hardware, report, progress, installLog])
  useEffect(() => api?.onProgress((text) => {
    setProgress(text.slice(-2000))
    setInstallLog((log) => `${log}${text}\n`.slice(-64000))
  }), [api])

  const setBusy = (busy: boolean) => { lockRef.current = busy; setLocked(busy) }
  const close = () => {
    if (lockRef.current) return
    dismissedRef.current = true
    controller.current?.abort()
    requestRef.current?.resolve({ id: 'stop', packages: [] })
    requestRef.current = null; setRequest(null)
    clearHealthCheckpoint()
    useUiStore.getState().hideDialog('health-check')
    void api?.acknowledge().catch(() => setNotice('Could not save the welcome preference.'))
  }
  const ask = (req: Omit<Request, 'resolve'>, signal: AbortSignal, saved?: HealthCheckpoint) => new Promise<{ id: string; packages: string[] }>((resolve, reject) => {
    signal.throwIfAborted()
    const pending: Request = { ...req, resolve: (answer) => { setRequest(null); requestRef.current = null; if (answer.id === 'back') reject(new GoBack()); else resolve(answer) } }
    const defaults = req.duplicates ? req.duplicates.filter((copy) => copy.active || !copy.removable).map(copyKey) : req.packages?.map((p) => p.name) ?? []
    const allowed = req.duplicates?.map(copyKey) ?? req.packages?.map((p) => p.name) ?? []
    setSelected(saved?.pendingTitle === req.title ? [...new Set([...saved.selected.filter((key) => allowed.includes(key)), ...(req.duplicates?.filter((copy) => !copy.removable).map(copyKey) ?? [])])] : defaults)
    lastPromptRef.current = req.title
    requestRef.current = pending; setRequest(pending)
  })
  const mutation = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true); setProgress('Preparing…')
    try { return await fn() } finally { setBusy(false); setProgress('') }
  }

  const start = async (saved?: HealthCheckpoint) => {
    if (!api || (running && !saved)) return
    const ac = new AbortController(); controller.current = ac
    const signal = ac.signal
    let rows: HealthResult[] = saved?.results ?? []
    let r: RHealth | null = saved?.runtime ?? null
    let repairedPackages = saved?.repairedPackages ?? false
    const put = (...items: HealthResult[]) => {
      signal.throwIfAborted()
      for (const item of items) { const old = rows.find((r) => r.id === item.id); rows = [...rows.filter((r) => r.id !== item.id), { ...item, repaired: item.status === 'pass' && old && (old.status !== 'pass' || old.repaired) ? true : item.repaired }] }
      setResults([...rows])
      runtimeRef.current = r; repairedRef.current = repairedPackages
    }
    const stages: { id: Step; work: () => Promise<void> }[] = []
    const stage = (id: Step, work: () => Promise<void>) => { stages.push({ id, work }) }
    setRunning(true); setResults([...rows]); if (!saved) setNotice(''); setHardware(saved?.hardware ?? null); setRequest(null); setInstallLog(saved?.installLog ?? '')
    // Every restored prompt still requires a fresh user choice. Only read-only
    // checks are repeated; accepted installs/downloads remain in the main process.
    let restoreSelection = !!saved
    const askStep = (req: Omit<Request, 'resolve'>) => {
      const selection = restoreSelection && req.title === saved?.pendingTitle ? saved : undefined
      if (selection) restoreSelection = false
      return ask(req, signal, selection)
    }
    try {
      await api.acknowledge()
      stage('r', async () => {
        r = await api.checkR()
        while (!r.path || !r.supported) {
          const plan = await api.installPlan('r')
          const canInstall = !!plan.command || plan.label.includes('official R installer')
          const answer = await askStep({ title: r.path ? 'R needs an update' : 'R was not found', detail: 'ouRGeo needs R 4.1 or newer to run its analysis. You can install R now, or choose an existing Rscript executable.', plan, choices: [
            { id: 'install', label: canInstall ? 'Approve and install R' : 'Open installation guide', primary: true },
            { id: 'browse', label: 'Choose Rscript…' }, { id: 'recheck', label: 'Recheck R' }, { id: 'skip', label: 'Skip R setup' },
          ] })
          signal.throwIfAborted()
          if (answer.id === 'skip') { put({ id: 'r-runtime', title: 'R installation', status: 'error', detail: 'R 4.1 or newer is required. Install R or choose Rscript in Settings → R Backend, then rerun this check.' }); return }
          if (answer.id === 'install') {
            if (canInstall) await mutation(() => api.install('r', true))
            else await window.electronAPI.shell.openExternal(plan.manualUrl)
          }
          if (answer.id === 'browse') {
            const path = await window.electronAPI.r.browseRscript()
            if (path) {
              // Existing picker persists the path even if the server cannot yet
              // start. Package diagnostics remain independent of server startup.
              await window.electronAPI.r.setAndRestartR(path).catch(() => {})
            }
          }
          r = await api.checkR()
        }
        put({ id: 'r-runtime', title: 'R installation', status: 'pass', detail: `R ${r.version} · ${r.path}`, repaired: r.configuredPathBroken })
        if (r.configuredPathBroken) put({ id: 'r-path', title: 'Rscript path', status: 'warning', detail: 'The saved Rscript path no longer works. A working installation was found; approve connecting it after the package check.' })
      })
      stage('packages', async () => {
        if (!r?.path || !r.supported) { put({ id: 'packages', title: 'R packages', status: 'skipped', detail: 'Install a supported R version to check and repair its packages.' }); return }
        r = await api.checkPackages()
        put(...packageResults(r))
        if (r.duplicates.length) {
          const copies = r.duplicates
          const answer = await askStep({ title: 'Choose which package copies to keep', saveProject: true, detail: 'Each checked copy will be kept; unchecked copies will be removed from the listed library. Keep one or more copies of every package, including multiple versions if needed. R currently prefers the copy marked “First in search order”. Protected or read-only copies must stay. Cleanup stops R and clears its objects; save your project before approving. It affects every project sharing these libraries.', duplicates: copies, choices: [{ id: 'remove-copies', label: 'Approve removing unchecked copies', primary: true }, { id: 'skip', label: 'Keep all copies and continue' }] })
          signal.throwIfAborted()
          if (answer.id === 'remove-copies') {
            const removed = copies.filter((copy) => !answer.packages.includes(copyKey(copy)))
            useSessionStore.getState().setRStatus('connecting')
            try { r = await mutation(() => api.removePackageCopies(removed, true)) }
            catch (e) { useSessionStore.getState().setRStatus('error'); throw e }
            repairedPackages = true
            put(...packageResults(r))
            const remaining = removed.filter((copy) => r!.duplicates.some((current) => copyKey(current) === copyKey(copy)))
            put({ id: 'duplicate-cleanup', title: 'Duplicate package cleanup', status: remaining.length ? 'warning' : 'pass', repaired: !remaining.length, detail: remaining.length ? 'Some selected copies remain. Review the cleanup output and recheck packages.' : `${removed.length} selected copies were removed. The remaining installations were rechecked; intentionally kept duplicates may still be listed.` })
          }
        }
        const repairs = r.packages.filter((p) => p.reason)
        if (repairs.length) {
          const answer = await askStep({ title: 'Review package repairs', saveProject: true, detail: `Select the packages to install, update or rebuild for R ${r.version}. Core dependencies are included because incompatible compiled packages can prevent Rscript from connecting. To replace loaded packages, repairs stop the current R session and clear its objects. Save your project before approving. Installs use CRAN and its dependencies; sfarc uses CCurtis1988/sfarc on GitHub. A repair can take several minutes. On Linux, spatial packages may also need GDAL, GEOS, PROJ and udunits development libraries.${repairs.some((p) => p.name === 's2') && r.s2 ? ` ${r.s2.repair} S2 repair library: ${r.s2.library}` : ''}`, packages: repairs, choices: [{ id: 'repair', label: 'Approve selected repairs', primary: true }, { id: 'skip', label: 'Skip repairs' }] })
          signal.throwIfAborted()
          if (answer.id === 'repair' && answer.packages.length) {
            useSessionStore.getState().setRStatus('connecting')
            try { r = await mutation(() => api.repairPackages(answer.packages, true)) }
            catch (e) { useSessionStore.getState().setRStatus('error'); throw e }
            repairedPackages = true
            put(...packageResults(r))
            const unresolved = r.packages.filter((p) => answer.packages.includes(p.name) && p.reason)
            put({ id: 'package-repair', title: 'Package repairs', status: unresolved.length ? 'warning' : 'pass', repaired: !unresolved.length, detail: unresolved.length ? `${unresolved.map((p) => `${p.name}: ${p.reason}`).join(' · ')}. Review the installer output and install any missing system libraries, then rerun.` : `${answer.packages.length} selected packages were installed or updated and rechecked.` })
          }
        }
        const isReady = await window.electronAPI.r.isReady()
        if (!isReady || repairedPackages || r.configuredPathBroken) {
          const answer = await askStep({ title: isReady ? 'Restart R to apply repairs?' : 'Connect the R backend?', saveProject: isReady, detail: isReady ? 'Restarting loads the repaired packages and clears the current R objects. Save your project before approving. You can skip this and restart later.' : 'Start the R server using the checked installation and verify that ouRGeo can connect.', choices: [{ id: 'connect', label: isReady ? 'Approve R restart' : 'Connect R', primary: true }, { id: 'skip', label: 'Skip for now' }] })
          signal.throwIfAborted()
          if (answer.id === 'skip') { if (!isReady) useSessionStore.getState().setRStatus('disconnected'); put({ id: 'r-server', title: 'R server connection', status: 'warning', detail: 'Connection or restart was deferred. Save your project and use Settings → R Backend to restart R before using repaired packages.' }); return }
          await mutation(() => api.connectR(true))
          await reconnectToR()
          repairedPackages = false
          if (r.configuredPathBroken) put({ id: 'r-path', title: 'Rscript path', status: 'pass', repaired: true, detail: 'Saved the working Rscript path for future launches.' })
        }
        await rClient.connect()
        const healthy = await rClient.health()
        put({ id: 'r-server', title: 'R server connection', status: healthy ? 'pass' : 'error', detail: healthy ? 'The R backend responds to ouRGeo.' : 'The R backend is not responding. Review required package repairs and the Rscript path.' })
      })
      stage('system', async () => {
        const hw = await api.hardware(); setHardware(hw)
        put({ id: 'ram', title: 'System memory', status: hw.freeRamGB >= 2 ? 'pass' : 'warning', detail: `${hw.totalRamGB.toFixed(1)} GB RAM · ${hw.freeRamGB.toFixed(1)} GB currently available${hw.freeRamGB < 2 ? '. Close other applications to free memory.' : '.'}` })
        put({ id: 'gpu', title: 'Graphics memory', status: hw.unifiedMemory || hw.gpus.some((g) => g.vramGB !== null) ? 'pass' : 'warning', detail: `${hw.gpus.map((g) => `${g.name}: ${g.vramGB === null ? 'VRAM unavailable' : `${g.vramGB.toFixed(1)} GB VRAM (${g.freeVramGB?.toFixed(1) ?? 'unknown'} GB free)`}`).join(' · ') || 'GPU memory could not be measured.'} ${hw.gpuNote}` })
        for (const disk of hw.storage) put({ id: `disk-${disk.label}`, title: disk.label, status: !disk.writable ? 'error' : disk.freeGB === null || disk.freeGB < 2 ? 'warning' : 'pass', detail: `${disk.freeGB === null ? 'Free storage unavailable' : `${disk.freeGB.toFixed(1)} GB free`} · ${disk.writable ? 'writable' : 'not writable'} · ${disk.path}${disk.freeGB !== null && disk.freeGB < 2 ? '. Free some storage before installing packages or models.' : ''}` })
        if (r?.path && r.packages.length) {
          put({ id: 'pandoc', title: 'Document export: Pandoc', status: r.tools.pandoc ? 'pass' : 'warning', detail: r.tools.pandoc ? 'Pandoc is available for document export.' : 'Optional: install Pandoc from pandoc.org for HTML and Word export. Inline R chunks still work.' })
          put({ id: 'latex', title: 'Document export: PDF', status: r.tools.latex ? 'pass' : 'warning', detail: r.tools.latex ? 'A LaTeX compiler is available.' : 'Optional: install a LaTeX distribution, such as TinyTeX, to export PDF documents.' })
        }
      })
      stage('ai', async () => {
        let connections = await inspectConnections(signal)
        const localModels = () => connections.filter((c) => c.models.length)
        put({ id: 'local-ai', title: 'Local AI models', status: localModels().length ? 'pass' : 'warning', detail: localModels().length ? localModels().map((c) => `${PROVIDER_LABELS[c.provider]}: ${c.models.join(', ')}`).join(' · ') : 'No models were found on the configured or common local servers. Set up a local model below, connect another server, or use a cloud provider.' })
        if (!localModels().length) {
          const answer = await askStep({ title: 'Set up your AI assistant', detail: 'Choose a local model matched to this computer, connect an existing server, or configure a cloud account. AI is optional; ouRGeo’s R tools work without it.', configure: true, choices: [{ id: 'continue', label: 'Continue and check configuration', primary: true }, { id: 'skip', label: 'Skip AI setup' }] })
          signal.throwIfAborted()
          if (answer.id === 'skip') { put({ id: 'ai-response', title: 'AI response test', status: 'skipped', detail: 'AI setup was skipped. Configure the assistant in Settings → AI Assistant whenever you are ready.' }); return }
          connections = await inspectConnections(signal)
          put({ id: 'local-ai', title: 'Local AI models', status: localModels().length ? 'pass' : 'warning', detail: localModels().length ? localModels().map((c) => `${PROVIDER_LABELS[c.provider]}: ${c.models.join(', ')}`).join(' · ') : 'No local models configured. A cloud assistant can still be used.' })
        }
        const ai = useAiStore.getState(); const model = ai.currentModel(); const keys = useApiKeysStore.getState().keys
        if (isLocalProvider(ai.provider)) {
          const selected = connections.find((c) => c.provider === ai.provider)
          if (!selected?.models.includes(model)) { put({ id: 'ai-selected', title: 'Selected assistant model', status: 'warning', detail: selected?.error || `The selected model ${model || '(none)'} is unavailable. Choose a listed model in Settings → AI Assistant.` }); return }
        } else if (['anthropic', 'openai', 'google'].includes(ai.provider) && !keys[ai.provider === 'google' ? 'google_gemini' : ai.provider]) {
          put({ id: 'ai-selected', title: 'Selected assistant model', status: 'warning', detail: 'Add the selected provider’s API key in Settings → AI Assistant, or select a local model.' }); return
        } else if (ai.provider === 'openai-subscription') {
          const account = await window.electronAPI.chatgpt.status()
          if (!account.planEnabled) { put({ id: 'ai-selected', title: 'ChatGPT connection', status: 'warning', detail: 'Sign in and enable ChatGPT plan usage in Settings → AI Assistant.' }); return }
        } else if (ai.provider === 'claude-cli') {
          const cli = await window.electronAPI.claudeCli.detect()
          const auth = cli ? await window.electronAPI.claudeCli.authStatus(cli.path) : null
          if (!auth?.loggedIn) { put({ id: 'ai-selected', title: 'Claude connection', status: 'warning', detail: 'Install and sign in to Claude Code, then recheck in Settings → AI Assistant.' }); return }
        }
        if (!model) { put({ id: 'ai-selected', title: 'Selected assistant model', status: 'warning', detail: 'Choose an assistant model before testing.' }); return }
        const answer = await askStep({ title: 'Test the assistant with one short message?', detail: `Provider: ${PROVIDER_LABELS[ai.provider]} · Model: ${model}. This sends only “Reply with the word Ready”, with no project files, chat history, or tools. Cloud models and subscriptions may use credits, incur charges, or count toward plan limits. Remote servers and Ollama cloud models may also charge. Exact cost is set by the provider.`, choices: [{ id: 'test', label: 'Approve message and any credit use', primary: true }, { id: 'skip', label: 'Skip response test' }] })
        signal.throwIfAborted()
        if (answer.id === 'test') put(await testAssistant(signal))
        else put({ id: 'ai-response', title: 'AI response test', status: 'skipped', detail: 'Configuration was checked; inference was skipped. No AI credits were used by the health check.' })
      })
      const resumeIndex = Math.max(0, stages.findIndex((stage) => stage.id === saved?.step))
      let restoreCompletedStep = !!saved?.atCheckpoint
      for (let index = resumeIndex; index < stages.length;) {
        signal.throwIfAborted()
        const current = stages[index]
        setStep(current.id); setProgress('')
        try {
          try {
            if (!restoreCompletedStep) {
              await current.work()
              rows = rows.filter((row) => row.id !== `${current.id}-failure`)
            }
            restoreCompletedStep = false
            setResults([...rows])
          } catch (e) {
            signal.throwIfAborted()
            if (e instanceof GoBack) throw e
            put({ id: `${current.id}-failure`, title: labels[current.id], status: 'error', detail: `${String(e)} Go back and return to this step to retry, or run the health check again.` })
          }
          await askStep({ title: `${labels[current.id]} checked`, detail: 'Review the results below. Back revisits the previous step and checks it again. Approved changes remain applied.', choices: [{ id: 'next', label: index === stages.length - 1 ? 'View results' : `Next: ${labels[stages[index + 1].id]}`, primary: true }] })
          signal.throwIfAborted()
          index++
        } catch (e) {
          if (!(e instanceof GoBack)) throw e
          if (index === 0) { setStep('welcome'); return }
          index--
        }
      }
      signal.throwIfAborted()
      const nextReport = { completedAt: new Date().toISOString(), results: rows }
      setStep('summary'); setReport(nextReport)
      await api.saveReport(nextReport).catch(() => setNotice('Results are shown here, but could not be saved for the next launch.'))
    } catch (e) {
      if (!signal.aborted) { setNotice(String(e)); setStep('summary') }
    } finally { setRunning(false); setRequest(null); requestRef.current = null; setProgress('') }
  }
  startRef.current = start

  const attention = results.filter((r) => r.status === 'error' || r.status === 'warning').length
  const removals = request?.duplicates?.filter((copy) => !selected.includes(copyKey(copy))) ?? []
  const validCleanup = removals.length > 0 && removals.every((copy) => copy.removable) &&
    (request?.duplicates ?? []).every((copy) => request!.duplicates!.some((kept) => kept.name === copy.name && selected.includes(copyKey(kept))))
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) close() }}>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
      <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[680px] max-w-[95vw] max-h-[90vh] flex flex-col bg-geo-panel border border-geo-border rounded-xl shadow-xl text-foreground focus:outline-none" onEscapeKeyDown={(e) => { if (locked) e.preventDefault() }} onPointerDownOutside={(e) => e.preventDefault()}>
        <div className="flex items-start gap-3 px-6 py-5 border-b border-geo-border shrink-0"><div className="rounded-lg p-2 bg-geo-bg text-geo-accent"><HeartPulse className="w-5 h-5" /></div><div className="flex-1"><Dialog.Title className="text-base font-semibold">ouRGeo health check</Dialog.Title><Dialog.Description className="text-xs text-geo-muted mt-1">Get your installation ready, one step at a time.</Dialog.Description></div><button className="p-1 text-geo-muted hover:text-foreground disabled:opacity-40" aria-label="Close health check" disabled={locked} onClick={close}><X className="w-4 h-4" /></button></div>
        {step !== 'welcome' && <ol className="flex gap-2 px-6 py-3 border-b border-geo-border text-[11px] shrink-0" aria-label="Health check progress">{steps.map((s, i) => <li key={s} className={`flex-1 ${step === s ? 'text-geo-accent font-medium' : 'text-geo-muted'}`} aria-current={step === s ? 'step' : undefined}>{i + 1}. {labels[s]}</li>)}</ol>}
        <div className="overflow-y-auto px-6 py-5 space-y-4">
          <p className="text-xs text-geo-muted">The health check may take several minutes to complete. Package repairs and model downloads can take longer.</p>
          {step === 'welcome' ? <>
            <h2 className="text-lg font-semibold">Welcome. Let’s get you ready to work.</h2>
            <p className="text-sm text-geo-muted leading-relaxed">Check R, repair missing or outdated packages, review your computer’s resources, and connect an AI assistant that fits your setup.</p>
            <div className="rounded-lg bg-geo-bg border border-geo-border p-4 text-xs text-geo-muted leading-relaxed">Starting runs diagnostics and checks CRAN and sfarc’s GitHub repository for package updates. You review and approve installations, package repairs, and any AI messages that might use credits. AI tests send no project data.</div>
            <p className="text-xs text-geo-muted">You can dismiss this now and run it anytime from Settings → Health check.</p>
            {report && <p className="text-xs text-geo-muted">Last completed: {new Date(report.completedAt).toLocaleString()} · {report.results.filter((r) => r.status === 'error' || r.status === 'warning').length} items needing attention.<button className="ml-2 text-geo-accent underline" onClick={() => { setResults(report.results); setStep('summary') }}>View results</button></p>}
          </> : <>
            {request ? <div className="space-y-4"><h2 className="text-sm font-semibold">{request.title}</h2><p className="text-xs text-geo-muted leading-relaxed">{request.detail}</p>
              {request.plan && <div className="rounded-lg bg-geo-bg border border-geo-border p-3 text-xs space-y-1"><p className="font-medium">{request.plan.label}</p><p className="text-geo-muted">{request.plan.detail}</p></div>}
              {request.packages && <div className="rounded-lg border border-geo-border overflow-hidden"><div className="px-3 py-2 bg-geo-bg text-xs flex items-center justify-between"><span>{selected.length} of {request.packages.length} selected</span><button className="text-geo-accent" onClick={() => setSelected(selected.length === request.packages!.length ? [] : request.packages!.map((p) => p.name))}>Toggle all</button></div><div className="max-h-64 overflow-auto">{request.packages.map((p) => <label key={p.name} className="flex gap-3 px-3 py-2 border-t border-geo-border text-xs"><input type="checkbox" checked={selected.includes(p.name)} onChange={(e) => setSelected((v) => e.target.checked ? [...v, p.name] : v.filter((n) => n !== p.name))} /><span><span className="font-medium">{p.name}</span><span className="text-geo-muted ml-2">{p.group} · {p.version || 'not installed'}{p.built ? ` · built for R ${p.built}` : ''}</span><span className="block text-geo-muted mt-1">{p.reason}</span></span></label>)}</div></div>}
              {request.configure && <LocalModelSetup hardware={hardware} locked={locked} onBusy={setBusy} />}
              {request.duplicates && <div className="space-y-3">
                {[...new Set(request.duplicates.map((copy) => copy.name))].map((name) => <fieldset key={name} className="rounded-lg border border-geo-border p-3 text-xs"><legend className="px-1 font-medium">{name} — select copies to keep</legend>
                  {request.duplicates!.filter((copy) => copy.name === name).map((copy) => <label key={copyKey(copy)} className="flex gap-3 py-2"><input type="checkbox" aria-label={`Keep ${copy.name} ${copy.version} in ${copy.library}`} disabled={locked || !copy.removable} checked={selected.includes(copyKey(copy))} onChange={(e) => setSelected((v) => e.target.checked ? [...v, copyKey(copy)] : v.filter((key) => key !== copyKey(copy)))} /><span className="min-w-0"><span className="font-medium">{copy.version}</span><span className="ml-2 text-geo-muted">{copy.active ? 'First in search order' : 'Shadowed copy'}{!copy.removable ? ' · Protected or read-only' : ''}</span><span className="block text-geo-muted break-all mt-1">{copy.library}{copy.built ? ` · Built for R ${copy.built}` : ''}</span><span className={`block mt-1 ${selected.includes(copyKey(copy)) ? 'text-geo-muted' : 'text-geo-error'}`}>{selected.includes(copyKey(copy)) ? 'Keep' : 'Remove'}</span></span></label>)}
                  {!request.duplicates!.some((copy) => copy.name === name && selected.includes(copyKey(copy))) && <p role="alert" className="text-geo-error">Keep at least one installation of {name}.</p>}
                </fieldset>)}
                <p className="text-xs text-geo-muted">{removals.length} copies selected for removal.</p>
              </div>}

            </div> : running ? <div role="status" className="flex items-center gap-2 text-xs text-geo-muted"><Loader2 className="w-4 h-4 animate-spin" />{locked ? 'Applying your approved changes…' : `Checking ${labels[step].toLowerCase()}…`}</div> : step === 'summary' ? <div><h2 className="text-base font-semibold">{attention ? 'Health check complete — a few things need attention' : 'Health check complete'}</h2><p className="text-xs text-geo-muted mt-2">{results.filter((r) => r.status === 'pass').length} ready · {results.filter((r) => r.repaired).length} fixed · {attention} need attention · {results.filter((r) => r.status === 'skipped').length} skipped</p></div> : <h2 className="text-sm font-semibold">Review {labels[step].toLowerCase()} results</h2>}
            {progress && <pre role="log" aria-label="Installation progress" className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded border border-geo-border bg-geo-bg p-3 text-[11px] text-geo-muted">{progress}</pre>}
            {results.length > 0 && <div aria-label="Health check results">{results.map((result) => <ResultRow key={result.id} result={result} />)}</div>}
            {!running && installLog && <details className="text-xs"><summary className="cursor-pointer text-geo-muted">Installation details</summary><pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded border border-geo-border bg-geo-bg p-3 text-[11px] text-geo-muted">{installLog}</pre></details>}
          </>}
          {notice && <p role="alert" className="text-xs text-geo-error">{notice}</p>}
        </div>
        <div className="px-6 py-4 border-t border-geo-border shrink-0 space-y-3">
          {request ? <>
            <p className="text-[11px] text-geo-muted">{locked ? 'Keep this window open while installation finishes.' : 'Review this step and choose how to continue.'}</p>
            <div className="flex flex-wrap gap-2"><button className={button} disabled={locked} onClick={() => request.resolve({ id: 'back', packages: [] })}>Back</button>{request.saveProject && <button className={button} disabled={locked} onClick={() => void mutation(async () => { const saved = await saveCurrentProject(); setNotice(saved ? 'Project saved. You can now approve the repair.' : 'Project was not saved.') }).catch((e) => setNotice(String(e)))}>Save project first…</button>}{request.choices.map((choice) => <button key={choice.id} className={choice.primary ? primary : button} disabled={locked || (choice.id === 'repair' && !selected.length) || (choice.id === 'remove-copies' && !validCleanup)} onClick={() => request.resolve({ id: choice.id, packages: selected })}>{choice.label}</button>)}</div>
          </> : <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[11px] text-geo-muted">{locked ? 'Keep this window open while installation finishes.' : running ? 'You can stop checks and return later.' : 'Your setup, your choices.'}</span>
            <div className="flex gap-2">
              {!running && step !== 'welcome' && <button className={button} onClick={() => setStep(steps[steps.indexOf(step) - 1] ?? 'welcome')}>Back</button>}
              {!running && step !== 'welcome' && step !== 'summary' && <button className={button} onClick={() => setStep(steps[steps.indexOf(step) + 1])}>Next</button>}
              <button className={button} disabled={locked} onClick={close}>{running ? 'Stop checks' : step === 'welcome' ? 'Maybe later' : 'Close'}</button>
              {!running && <button className={primary} onClick={() => void start()}>{step === 'welcome' ? 'Confirm and run health check' : 'Run again'}<ArrowRight className="inline w-3 h-3 ml-2" /></button>}
            </div>
          </div>}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
