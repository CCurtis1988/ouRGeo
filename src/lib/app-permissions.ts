/**
 * Which browser permissions ouRGeo's renderer may have.
 *
 * A pure predicate in its own file, and listed in `tsconfig.node.json`, for
 * one reason: **an allowlist is only as good as the list of things the app
 * already did.** Written inline in `index.ts` as `permission === 'media'`, it
 * shipped in v1.12 and silently broke every Copy button in the app — the AI
 * chat's code blocks, both Export Code dialogs, the toolbox, the console's and
 * the terminal's "copy path", and the terminal's own Ctrl+Shift+C — because
 * `navigator.clipboard` asks the permission CHECK handler, which the same
 * predicate answers. Nothing failed loudly: none of those call sites checked
 * the promise, so each showed a tick over an unchanged clipboard.
 *
 * Out here it is a list you can read, and one a test can hold you to.
 */

/**
 * The permissions the app is granted.
 *
 * - `media` — the microphone, for voice input. The check handler is also what
 *   `enumerateDevices` consults before revealing device labels, so without it
 *   the microphone picker is a list of blanks.
 * - `clipboard-sanitized-write` — every Copy button. Writing is an action the
 *   user asked for and can see the result of, and it cannot read anything.
 *
 * Adding to this list is granting a standing capability to all renderer code.
 * The bar is that the app has a feature that needs it and no narrower route
 * exists.
 */
export const GRANTED_PERMISSIONS: readonly string[] = ['media', 'clipboard-sanitized-write']

/**
 * Permissions deliberately refused, with the reason, so a later reader does
 * not "fix" one back in.
 *
 * `clipboard-read` is the one worth spelling out: it is not the counterpart of
 * `clipboard-sanitized-write` but a much larger power — a licence for any code
 * in the renderer to read whatever the user last copied, a password or a token
 * included, silently and at any time. The single place ouRGeo needs the
 * clipboard's contents is the terminal's Ctrl+Shift+V, which reads it in the
 * main process (`clipboard:readText`) when the keystroke arrives instead.
 */
export const REFUSED_WITH_REASON: Readonly<Record<string, string>> = {
  'clipboard-read':
    'reads whatever the user last copied; the terminal uses clipboard:readText on a keystroke instead',
  geolocation: 'ouRGeo asks for a location on the map, never from the browser',
  notifications: 'nothing here belongs outside the window',
  midi: 'no feature uses it',
  hid: 'no feature uses it',
  serial: 'no feature uses it',
  usb: 'no feature uses it',
  'display-capture': 'no feature uses it',
  'persistent-storage': 'ouRGeo writes through the main process, not the browser',
}

export function isPermissionAllowed(permission: string): boolean {
  return GRANTED_PERMISSIONS.includes(permission)
}
