/** Plugin descriptors reference host-reviewed profiles. They never carry
 * executable adapters, credentials, namespaces or self-issued certificates. */
export interface ProviderContribution { id: string; label: string; profileId: string }
export interface PublicProviderContribution extends ProviderContribution { pluginId: string; manifestSha256: string; available: boolean }
export interface ProviderContributionRef { pluginId: string; id: string; manifestSha256: string }
export function providerContributions(value: unknown): ProviderContribution[] {
  if (!Array.isArray(value) || value.length > 16) throw new Error('Declare at most 16 memory provider profiles.')
  const result = value.map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['id', 'label', 'profileId'].includes(key))
      || typeof item.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(item.id)
      || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 120
      || typeof item.profileId !== 'string' || !/^[a-z][a-z0-9-]{0,95}$/.test(item.profileId)) throw new Error('A memory provider needs a local id, label and host-reviewed profileId; it cannot grant scope, trust or execution.')
    return { id: item.id, label: item.label, profileId: item.profileId }
  })
  if (new Set(result.map(item => item.id)).size !== result.length) throw new Error('Memory provider IDs must be unique within this plugin.')
  return result
}
