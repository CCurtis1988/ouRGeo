import { describe, it, expect } from 'vitest'
import { serviceSpec, serviceConnection } from './service-policy'
import { readManifest } from './manifest'

describe('background service policy', () => {
  it('accepts declared JavaScript assets and requires explicit service permission', () => {
    const service = { entry: 'server/service.mjs', files: ['server/service.mjs', 'web/index.html'] }
    const base = { id: 'media', name: 'Media', version: '1.0.0', main: 'main.tsx', service }
    expect(readManifest(JSON.stringify(base), '1.16.0').ok).toBe(false)
    expect(readManifest(JSON.stringify({ ...base, permissions: ['service'] }), '1.16.0').manifest?.service).toEqual(service)
  })
  it('refuses traversal, absolute paths, executables and incomplete file lists', () => {
    for (const entry of ['../outside.mjs', '/tmp/evil.mjs', 'C:\\evil.js', 'server/tool.exe', '.cache/main.js']) {
      expect(() => serviceSpec({ entry, files: [entry] })).toThrow()
    }
    expect(() => serviceSpec({ entry: 'server/main.mjs', files: ['web/main.js'] })).toThrow()
    expect(() => serviceSpec({ entry: 'server/main.mjs', files: ['server/main.mjs', 'main.js'] })).toThrow()
  })
  it('requires a private loopback endpoint and a strong connection token', () => {
    const token = 'a'.repeat(48)
    expect(serviceConnection({ url: 'http://127.0.0.1:12345', token }).url).toBe('http://127.0.0.1:12345')
    for (const url of ['https://example.com', 'http://127.0.0.1', 'http://localhost:1234', 'http://user@127.0.0.1:1234', 'http://127.0.0.1:1234/path']) {
      expect(() => serviceConnection({ url, token })).toThrow()
    }
    expect(() => serviceConnection({ url: 'http://127.0.0.1:1234', token: 'short' })).toThrow()
  })
})
