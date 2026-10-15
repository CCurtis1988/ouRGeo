// Shared with main's native-service boundary. Permission renewal in the
// renderer is feedback; a saved enabled flag is not permission to expand APIs.
const known = ['network', 'r', 'ui', 'service', 'context-source', 'memory-provider']
export const LEGACY_PLUGIN_PERMISSIONS: readonly string[] = ['network', 'r', 'ui', 'service']
export function pluginPermissionsApproved(requested: unknown, grants: unknown): boolean {
  if (!Array.isArray(requested) || requested.length > 16 || requested.some(permission => !known.includes(permission))) return false
  if (grants === undefined) return requested.every(permission => LEGACY_PLUGIN_PERMISSIONS.includes(permission))
  return Array.isArray(grants) && grants.length <= 16 && grants.every(permission => typeof permission === 'string' && known.includes(permission))
    && requested.every(permission => grants.includes(permission))
}
