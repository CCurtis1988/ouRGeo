/** Pure manifest policy shared by the renderer and Electron main process. */
export interface ServiceSpec { entry: string; files: string[] }
export interface ServiceConnection { url: string; token: string }

export function serviceSpec(raw: unknown): ServiceSpec {
  const spec = raw as Partial<ServiceSpec> | null
  const safe = (path: unknown): path is string => typeof path === 'string'
    && /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:mjs|cjs|js|json|css|html|svg|txt|md)$/.test(path)
  if (!spec || !safe(spec.entry) || !/\.(mjs|cjs|js)$/.test(spec.entry)) {
    throw new Error('"service.entry" must name a JavaScript file inside the plugin folder.')
  }
  if (!Array.isArray(spec.files) || !spec.files.length || spec.files.length > 200
      || !spec.files.every(safe) || !spec.files.includes(spec.entry)) {
    throw new Error('"service.files" must list the service entry and its assets using relative paths (at most 200).')
  }
  if (spec.files.some(path => path === 'main.js' || path === 'ourgeo-plugin.json')) {
    throw new Error('Service assets cannot replace the plugin manifest or built renderer entry.')
  }
  return { entry: spec.entry, files: [...new Set(spec.files)] }
}

export function serviceConnection(raw: unknown): ServiceConnection {
  const data = raw as Partial<ServiceConnection> | null
  if (!data || typeof data.url !== 'string' || typeof data.token !== 'string'
      || !/^[a-f0-9]{48,128}$/.test(data.token)) throw new Error('Invalid service connection.')
  const url = new URL(data.url)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Services must listen on an ephemeral local IPv4 port.')
  }
  return { url: url.origin, token: data.token }
}
