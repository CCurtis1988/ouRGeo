import { useCallback, useEffect, useState } from 'react'
import { useAiStore } from '@/store/ai'
import { useContextStore } from '@/store/context'
import { chargeMicros } from '@/lib/context/providers/maintenance'
import type { ChatBudgetStatus } from '@/lib/context/chat-budget'

export function ChatBudget(): React.ReactElement {
  const available = useContextStore(state => state.personalMemoryAvailable)
  const provider = useAiStore(state => state.provider), model = useAiStore(state => state.currentModel())
  const [status, setStatus] = useState<ChatBudgetStatus | null>(null)
  const [enabled, setEnabled] = useState(false), [daily, setDaily] = useState('0'), [monthly, setMonthly] = useState('0')
  const [rates, setRates] = useState(['', '', '', ''])
  const [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const apply = useCallback((value: ChatBudgetStatus) => {
    setStatus(value); setEnabled(value.policy.enabled); setDaily(String(value.policy.dailyMicros / 1e6)); setMonthly(String(value.policy.monthlyMicros / 1e6))
  }, [])
  const refresh = useCallback(async () => {
    setBusy(true); setMessage('')
    try { apply(await window.electronAPI.context.chatBudgetStatus()) }
    catch (error) { setStatus(null); setMessage(String(error)) }
    finally { setBusy(false) }
  }, [apply])
  useEffect(() => { if (available) void refresh(); else setStatus(null) }, [available, refresh])
  useEffect(() => {
    const price = status?.policy.prices.find(price => price.provider === provider && price.model === model)
    setRates(price ? [price.inputMicrosPerMillion, price.outputMicrosPerMillion, price.cachedMicrosPerMillion, price.writeMicrosPerMillion].map(value => String(value / 1e6)) : ['', '', '', ''])
    setReviewed(false)
  }, [status, provider, model])
  const save = async (): Promise<void> => {
    if (!status) return
    setBusy(true); setMessage('')
    try {
      const parse = (value: string): number => { const amount = value.trim() ? chargeMicros(Number(value)) : undefined; if (amount === undefined) throw new Error('Enter non-negative USD amounts. Unknown rates must remain blank.'); return amount }
      let prices = status.policy.prices
      if (reviewed) {
        const values = rates.map(parse)
        prices = [...prices.filter(price => price.provider !== provider || price.model !== model), { provider, model, inputMicrosPerMillion: values[0], outputMicrosPerMillion: values[1], cachedMicrosPerMillion: values[2], writeMicrosPerMillion: values[3], reviewedAt: new Date().toISOString() }]
      }
      const lease = await window.electronAPI.context.lease()
      apply(await window.electronAPI.context.configureChatBudget({ revision: status.policy.revision + 1, enabled, dailyMicros: parse(daily), monthlyMicros: parse(monthly), prices }, lease.id))
      setMessage('Estimated chat budget saved. Every subsequent invocation checks its own reservation.')
    } catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }
  const money = (value: number): string => (value / 1e6).toLocaleString('en-GB', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 })
  return <details aria-label="Estimated chat budget" className="text-[11px] text-geo-muted border border-geo-border rounded p-2">
    <summary className="cursor-pointer">Estimated chat budget</summary>
    <p className="mt-2">Optional daily/monthly estimates cover chat on this device, across projects. Input plus reserved output is committed before each request, including tool follow-ups and retries. Memory maintenance has its own budget. Limits use UTC days and months.</p>
    <p className="mt-1">These are estimated budgets. Provider bills may exceed estimates; set provider-side quotas for invoice limits. Subscription transports with internal processing are blocked while this budget is enabled.</p>
    {!available ? <p className="mt-2">Enable protected storage before configuring a chat budget.</p> : <>
      <label className="flex items-center gap-2 mt-2"><input aria-label="Enforce estimated chat budget" type="checkbox" checked={enabled} disabled={busy || !status} onChange={event => setEnabled(event.target.checked)} />Enforce estimated chat budget</label>
      <div className="flex flex-wrap gap-3 mt-2">{[['Daily chat estimate in USD', daily, setDaily], ['Monthly chat estimate in USD', monthly, setMonthly]].map(([label, value, change]) => <label key={String(label)} className="flex items-center gap-2">{String(label)}<input aria-label={String(label)} type="number" min="0" step="0.01" value={String(value)} disabled={busy || !status} onChange={event => (change as typeof setDaily)(event.target.value)} className="w-24 bg-geo-bg border border-geo-border rounded p-1" /></label>)}</div>
      <p className="mt-2">Current model: {provider} / {model}. Enter provider rates in USD per million tokens. Rates expire after 30 days; zero is an explicit rate, not a substitute for unknown pricing.</p>
      <div className="flex flex-wrap gap-3 mt-2">{['Input', 'Output including billed reasoning', 'Cached input', 'Cache write'].map((label, index) => <label key={label} className="flex items-center gap-2">{label}<input aria-label={`${label} USD per million tokens`} type="number" min="0" step="0.01" value={rates[index]} disabled={busy || !status} onChange={event => setRates(values => values.map((value, row) => row === index ? event.target.value : value))} className="w-24 bg-geo-bg border border-geo-border rounded p-1" /></label>)}</div>
      <label className="flex items-center gap-2 mt-2"><input aria-label="I checked these model rates" type="checkbox" checked={reviewed} disabled={busy || !status} onChange={event => setReviewed(event.target.checked)} />I checked these model rates with my provider</label>
      <div className="flex gap-3 mt-2"><button disabled={busy || !status} className="text-geo-accent disabled:opacity-50" onClick={() => void save()}>Save chat budget</button><button disabled={busy} className="text-geo-accent disabled:opacity-50" onClick={() => void refresh()}>Refresh chat budget</button></div>
      {status && <p className="mt-2">Estimated today: {money(status.summary.dailyMicros)} · This month: {money(status.summary.monthlyMicros)} · Pending reserves: {money(status.summary.outstandingMicros)} ({status.summary.pendingReceipts} requests); {status.summary.unknownPriceReceipts} unpriced receipts.</p>}
      <p className="mt-1">Missing counters remain pending across cancellation, restart and date changes. Earlier unpriced activity remains unknown; no invoice total is inferred.</p>
    </>}
    {message && <p role="status" className="mt-2">{message}</p>}
  </details>
}
