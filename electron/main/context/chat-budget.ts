import { inferenceProviders, type InferenceUsageReceipt } from '../../../src/lib/context/inference-usage'
import { defaultChatBudget, estimatedChatCost, reconciledChatCost, summariseChatCharges, type ChatBudgetPolicy, type ChatBudgetSummary, type ChatCharge } from '../../../src/lib/context/chat-budget'
import { redactContext } from '../../../src/lib/context/policy'

export interface ChatBudgetPort {
  policy: () => ChatBudgetPolicy | undefined
  charges: () => ChatCharge[]
  charge: (receipt: InferenceUsageReceipt) => ChatCharge | undefined
  putPolicy: (policy: ChatBudgetPolicy) => void
  putCharge: (charge: ChatCharge) => void
  transaction: <T>(action: () => T) => T
}
const amount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1e12
export class ChatBudgetLedger {
  constructor(private port: ChatBudgetPort) {}
  policy(): ChatBudgetPolicy { return this.port.policy() ?? { ...defaultChatBudget, prices: [] } }
  configure(input: ChatBudgetPolicy, now = Date.now()): ChatBudgetPolicy {
    return this.port.transaction(() => {
      if (!input || Object.keys(input).some(key => !['revision', 'enabled', 'dailyMicros', 'monthlyMicros', 'prices'].includes(key))
        || typeof input.enabled !== 'boolean' || !amount(input.dailyMicros) || !amount(input.monthlyMicros) || input.dailyMicros > input.monthlyMicros
        || input.enabled && (!input.dailyMicros || !input.monthlyMicros) || input.revision !== this.policy().revision + 1
        || !Array.isArray(input.prices) || input.prices.length > 100) throw new Error('Refresh chat budget settings and enter valid daily/monthly USD estimates.')
      const identities = new Set<string>()
      for (const price of input.prices) {
        const retained = this.policy().prices.some(previous => JSON.stringify(previous) === JSON.stringify(price))
        if (!price || Object.keys(price).some(key => !['provider', 'model', 'inputMicrosPerMillion', 'outputMicrosPerMillion', 'cachedMicrosPerMillion', 'writeMicrosPerMillion', 'reviewedAt'].includes(key))
          || !inferenceProviders.includes(price.provider) || typeof price.model !== 'string' || !/^[\p{L}\p{N}_.:/-]{1,128}$/u.test(price.model) || redactContext(price.model) !== price.model
          || ![price.inputMicrosPerMillion, price.outputMicrosPerMillion, price.cachedMicrosPerMillion, price.writeMicrosPerMillion].every(amount)
          || typeof price.reviewedAt !== 'string' || !Number.isFinite(Date.parse(price.reviewedAt)) || Date.parse(price.reviewedAt) > now
          || !retained && now - Date.parse(price.reviewedAt) > 30 * 86_400_000) throw new Error('Enter explicit model rates reviewed within the last 30 days; credentials and arbitrary metadata are refused.')
        const key = JSON.stringify([price.provider, price.model])
        if (identities.has(key)) throw new Error('Use one price per provider and model.')
        identities.add(key)
      }
      this.port.putPolicy(input)
      return input
    })
  }
  summary(scope?: string, chatId?: string, now = Date.now()): ChatBudgetSummary {
    return summariseChatCharges(this.port.charges().filter(charge => (!scope || charge.scope === scope) && (!chatId || charge.chatId === chatId)), now)
  }
  prepare(receipt: InferenceUsageReceipt, model: string, outputTokens: number, now = Date.now()): ChatCharge {
    return this.port.transaction(() => {
      if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > 1_000_000 || receipt.estimatedInputTokens === undefined || receipt.final || receipt.accountingScope !== 'invocation') throw new Error('Reserve bounded input/output before dispatch, using a new invocation receipt.')
      const previous = this.port.charge(receipt)
      if (previous) throw new Error('This invocation was already prepared. Inspect its receipt before retrying; create a distinct invocation for a new request.')
      const policy = this.policy()
      const price = ['claude-cli', 'openai-subscription'].includes(receipt.provider) ? undefined : policy.prices.find(price => price.provider === receipt.provider && price.model === model && now - Date.parse(price.reviewedAt) <= 30 * 86_400_000)
      if (policy.enabled && ['claude-cli', 'openai-subscription'].includes(receipt.provider)) throw new Error('BUDGET_LIMIT: this subscription transport owns internal processing. Use a bounded API/local transport or disable the estimated chat budget; no invoice cap is claimed.')
      if (policy.enabled && !price) throw new Error('BUDGET_LIMIT: model pricing is missing or older than 30 days. Review its input/output/cache rates in chat budget settings before sending.')
      const reservedMicros = price ? estimatedChatCost({ ...price, inputMicrosPerMillion: Math.max(price.inputMicrosPerMillion, price.cachedMicrosPerMillion, price.writeMicrosPerMillion) }, receipt.estimatedInputTokens, outputTokens) : null
      const summary = policy.enabled ? this.summary(undefined, undefined, now) : undefined
      if (summary && (summary.pendingUnknownPriceReceipts
        || summary.dailyMicros + summary.outstandingMicros + reservedMicros! > policy.dailyMicros
        || summary.monthlyMicros + summary.outstandingMicros + reservedMicros! > policy.monthlyMicros)) throw new Error('BUDGET_LIMIT: the estimated chat budget is covered or unresolved unpriced requests remain. Review outstanding receipts or the limits before sending.')
      const charge: ChatCharge = { id: receipt.id, scope: receipt.scope, chatId: receipt.chatId, turnId: receipt.turnId, invocation: receipt.invocation, attempt: receipt.attempt, createdAt: new Date(now).toISOString(),
        ...(price ? { price: { ...price } } : {}), reservedMicros, estimatedMicros: null, state: 'pending' }
      this.port.putCharge(charge)
      return charge
    })
  }
  reconcile(receipt: InferenceUsageReceipt): void {
    const charge = this.port.charge(receipt)
    if (!charge || charge.state === 'reconciled') return
    const cost = charge.price ? reconciledChatCost(charge.price, receipt) : null
    // Final reported counters give a price-based estimate, never an invoice.
    // Unknown/cancelled calls stay reserved across restarts and date changes.
    if (cost !== null || !charge.price && receipt.final && receipt.reported?.inputTokens !== undefined && receipt.reported.outputTokens !== undefined) this.port.putCharge({ ...charge, estimatedMicros: cost, state: 'reconciled' })
  }
}
