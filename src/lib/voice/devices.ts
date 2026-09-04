// Which microphone, and what it is called.
//
// The awkward part of `enumerateDevices` is that labels are empty until the
// page has been granted microphone access at least once — before that a user
// picking a device sees "Microphone", "Microphone 2", and cannot tell which is
// the headset. So the picker says so rather than showing a list of blanks, and
// the labels fill in the moment the first recording starts.

export interface InputDevice {
  deviceId: string
  label: string
  /** False when the browser has not yet revealed the real name. */
  named: boolean
}

/** The entry meaning "whatever the system is set to", which is the default. */
export const SYSTEM_DEFAULT: InputDevice = {
  deviceId: '',
  label: 'System default',
  named: true,
}

export async function listInputDevices(): Promise<InputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [SYSTEM_DEFAULT]
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => [])
  const inputs = all
    .filter((d) => d.kind === 'audioinput')
    // Chromium lists a synthetic "default"/"communications" entry that mirrors
    // whichever real device the OS has selected. `SYSTEM_DEFAULT` already says
    // that in the user's language, so listing them again is two names for one
    // thing in the same menu.
    .filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Microphone ${i + 1}`,
      named: d.label.length > 0,
    }))
  return [SYSTEM_DEFAULT, ...inputs]
}

/** The label to show for a stored device id, which may no longer be present. */
export function labelFor(devices: InputDevice[], deviceId: string): string {
  if (!deviceId) return SYSTEM_DEFAULT.label
  return devices.find((d) => d.deviceId === deviceId)?.label
    ?? 'Microphone no longer connected'
}

/** Whether a stored choice still exists — a headset unplugged between sessions. */
export function stillPresent(devices: InputDevice[], deviceId: string): boolean {
  return deviceId === '' || devices.some((d) => d.deviceId === deviceId)
}

/** Subscribe to devices appearing and disappearing; returns an unsubscribe. */
export function onDevicesChanged(handler: () => void): () => void {
  const target = navigator.mediaDevices
  if (!target?.addEventListener) return () => {}
  target.addEventListener('devicechange', handler)
  return () => target.removeEventListener('devicechange', handler)
}
