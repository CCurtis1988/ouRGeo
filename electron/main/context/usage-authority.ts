import { randomUUID } from 'node:crypto'
import { validateInferenceUsage, type InferenceUsageInput, type InferenceUsageProvider } from '../../../src/lib/context/inference-usage'
import type { WorkspaceLease } from './scope'

/** Only numeric accounting survives a scope change. These bounded capabilities
 * cannot read memories or authorise a project mutation, and die with the host. */
export class UsageAuthority {
  private grants = new Map<string, { scope: string; chatId: string; turnId: string; provider: InferenceUsageProvider; model: string; expires: number }>()
  constructor(private now = Date.now) {}
  private sweep(): void {
    for (const [id, grant] of this.grants) if (grant.expires <= this.now()) this.grants.delete(id)
  }
  begin(lease: WorkspaceLease, suppliedLease: string, chatId: string, turnId: string, provider: InferenceUsageProvider, model = ''): string {
    if (lease.id !== suppliedLease) throw new Error('SCOPE_CHANGED')
    const scope = lease.projectId ? `project:${lease.projectId}` : 'global'
    validateInferenceUsage({ chatId, turnId, provider, invocation: 1, attempt: 0, accountingScope: 'invocation', delivery: 'prepared', final: false }, scope)
    this.sweep()
    if (this.grants.size >= 256) throw new Error('Inference accounting is busy. Retry after existing turns settle.')
    const id = randomUUID()
    if (typeof model !== 'string' || model.length > 128) throw new Error('Choose a bounded configured model identity.')
    this.grants.set(id, { scope, chatId, turnId, provider, model, expires: this.now() + 86_400_000 })
    return id
  }
  end(id: string): void { this.grants.delete(id) }
  model(id: string): string { this.sweep(); const grant = this.grants.get(id); if (!grant) throw new Error('Inference authority expired.'); return grant.model }
  scope(id: string, inputs: InferenceUsageInput[]): string {
    this.sweep()
    const grant = this.grants.get(id)
    if (!grant) throw new Error('Inference accounting authority expired. Existing receipts are preserved.')
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 64) throw new Error('Use a bounded invocation accounting batch.')
    for (const input of inputs) {
      validateInferenceUsage(input, grant.scope)
      if (input.chatId !== grant.chatId || input.turnId !== grant.turnId || input.provider !== grant.provider) throw new Error('Inference accounting belongs to another turn.')
    }
    return grant.scope
  }
}
