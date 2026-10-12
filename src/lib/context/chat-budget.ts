import type { InferenceUsageProvider, InferenceUsageReceipt } from './inference-usage'

/** Prices are explicitly supplied by the user, never fetched or invented.
 * Integer millionths of USD preserve small charges; these remain estimates. */
export interface ChatPrice {
  provider: InferenceUsageProvider
  model: string
  inputMicrosPerMillion: number
  outputMicrosPerMillion: number
  cachedMicrosPerMillion: number
  writeMicrosPerMillion: number
  reviewedAt: string
}
export interface ChatBudgetPolicy {
  revision: number
  enabled: boolean
  dailyMicros: number
  monthlyMicros: number
  prices: ChatPrice[]
}
export interface ChatCharge {
  id: string
  scope: string
  chatId: string
  turnId: string
  invocation: number
  attempt: number
  createdAt: string
  price?: ChatPrice
  reservedMicros: number | null
  estimatedMicros: number | null
  state: 'pending' | 'reconciled'
}
export interface ChatBudgetSummary {
  estimatedMicros: number | null
  outstandingMicros: number
  unknownPriceReceipts: number
  pendingUnknownPriceReceipts: number
  pendingReceipts: number
  dailyMicros: number
  monthlyMicros: number
}
export interface ChatBudgetStatus { policy: ChatBudgetPolicy; summary: ChatBudgetSummary }
export const defaultChatBudget: ChatBudgetPolicy = { revision: 0, enabled: false, dailyMicros: 0, monthlyMicros: 0, prices: [] }

export function estimatedChatCost(price: ChatPrice, input: number, output: number, cached = 0, written = 0): number {
  // BigInt avoids a fractional-cent charge rounding to zero or multiplication
  // exceeding Number's integer range before conversion back to USD millionths.
  const numerator = BigInt(input - cached - written) * BigInt(price.inputMicrosPerMillion)
    + BigInt(cached) * BigInt(price.cachedMicrosPerMillion) + BigInt(written) * BigInt(price.writeMicrosPerMillion)
    + BigInt(output) * BigInt(price.outputMicrosPerMillion)
  const micros = Number((numerator + 999_999n) / 1_000_000n)
  if (!Number.isSafeInteger(micros) || micros < 0) throw new Error('The price estimate exceeds the supported range. Review model rates before sending.')
  return micros
}

export function reconciledChatCost(price: ChatPrice, receipt: InferenceUsageReceipt): number | null {
  const usage = receipt.reported
  if (!receipt.final || usage?.inputTokens === undefined || usage.outputTokens === undefined
    || usage.reasoningTokens !== undefined && usage.reasoningIncludedInOutput === undefined) return null
  const cached = usage.cachedInputTokens ?? 0, written = usage.cacheWriteTokens ?? 0
  if (cached + written > usage.inputTokens) throw new Error('Cache counters exceed reported input; preserve the reservation for review.')
  return estimatedChatCost(price, usage.inputTokens,
    usage.outputTokens + (usage.reasoningIncludedInOutput === false ? usage.reasoningTokens ?? 0 : 0), cached, written)
}

export function summariseChatCharges(charges: ChatCharge[], now = Date.now()): ChatBudgetSummary {
  const today = new Date(now).toISOString().slice(0, 10), month = today.slice(0, 7)
  let estimatedMicros = 0, outstandingMicros = 0, unknownPriceReceipts = 0, pendingUnknownPriceReceipts = 0, pendingReceipts = 0, dailyMicros = 0, monthlyMicros = 0
  for (const charge of charges) {
    if (!charge.price) unknownPriceReceipts++
    if (charge.state === 'pending') {
      if (!charge.price) pendingUnknownPriceReceipts++
      pendingReceipts++
      outstandingMicros += Math.max(charge.reservedMicros ?? 0, charge.estimatedMicros ?? 0)
    } else {
      estimatedMicros += charge.estimatedMicros ?? 0
      if (charge.createdAt.slice(0, 10) === today) dailyMicros += charge.estimatedMicros ?? 0
      if (charge.createdAt.slice(0, 7) === month) monthlyMicros += charge.estimatedMicros ?? 0
    }
  }
  return { estimatedMicros: unknownPriceReceipts ? null : estimatedMicros, outstandingMicros, unknownPriceReceipts, pendingUnknownPriceReceipts, pendingReceipts, dailyMicros, monthlyMicros }
}
