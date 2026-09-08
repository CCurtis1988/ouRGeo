import { describe, it, expect } from 'vitest'
import { isPermissionAllowed, GRANTED_PERMISSIONS, REFUSED_WITH_REASON } from './app-permissions'

describe('the renderer’s permission allowlist', () => {
  it('lets the microphone through, which is what it was written for', () => {
    expect(isPermissionAllowed('media')).toBe(true)
  })

  it('lets a Copy button reach the clipboard', () => {
    // The regression this file exists for. `navigator.clipboard.writeText`
    // asks the permission CHECK handler — it never reaches the request
    // handler — so an allowlist of `media` alone rejected every Copy button in
    // ouRGeo with "Write permission denied", and every one of them showed a
    // success tick anyway because none checked the promise.
    expect(isPermissionAllowed('clipboard-sanitized-write')).toBe(true)
  })

  it('does NOT let anything read the clipboard', () => {
    // Not the counterpart of writing: it is a standing licence to read
    // whatever the user last copied. The terminal's Ctrl+Shift+V reads it in
    // the main process, on the keystroke, instead.
    expect(isPermissionAllowed('clipboard-read')).toBe(false)
  })

  it('refuses everything the app has no feature for', () => {
    for (const p of ['geolocation', 'notifications', 'midi', 'hid', 'serial', 'usb']) {
      expect(isPermissionAllowed(p)).toBe(false)
    }
    // An unknown permission is refused rather than defaulted in — Electron
    // grants by DEFAULT when no handler is registered, which is the hole the
    // allowlist closed.
    expect(isPermissionAllowed('some-future-capability')).toBe(false)
  })

  it('never lists a permission as both granted and refused', () => {
    for (const p of GRANTED_PERMISSIONS) {
      expect(REFUSED_WITH_REASON[p]).toBeUndefined()
    }
  })

  it('gives every refusal a reason, so nobody quietly grants one back', () => {
    for (const [p, why] of Object.entries(REFUSED_WITH_REASON)) {
      expect(why.length, `${p} needs a reason`).toBeGreaterThan(10)
    }
  })
})
