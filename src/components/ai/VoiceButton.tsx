import React, { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, MicOff } from 'lucide-react'
import { Button } from '../ui/button'
import { ContextMenu, type ContextMenuItem } from '../ui/context-menu'
import { useVoiceStore } from '@/store/voice'
import { cancelDictation, startDictation, stopDictation } from '@/lib/voice/dictation'
import { listInputDevices, onDevicesChanged } from '@/lib/voice/devices'
import { resolveService, serviceList } from '@/lib/voice/registry'
import { BUILTIN_WHISPER_ID } from '@/lib/voice/services/builtin-whisper'
import { useUiStore } from '@/store/ui'
import { cn } from '@/lib/utils'

interface VoiceButtonProps {
  /** Put a finished transcript into the composer at the caret. */
  onTranscript: (text: string) => void
  disabled?: boolean
}

/**
 * The microphone, and the one control that shows ouRGeo is hearing you.
 *
 * The ring behind the icon scales with the live input level. It is updated
 * from a `requestAnimationFrame` loop writing to the DOM node directly, NOT
 * from React state: the level arrives about fifty times a second, and a
 * component re-rendering at that rate for the whole of a dictation would make
 * the composer stutter while someone is talking into it.
 *
 * It must also visibly respond to SILENCE. A ring that sits still whatever
 * happens is how a user discovers they have the wrong microphone selected —
 * so the resting state is small and the transform is not smoothed away.
 */
export function VoiceButton({ onTranscript, disabled }: VoiceButtonProps): React.ReactElement {
  const status = useVoiceStore((s) => s.status)
  const setDevices = useVoiceStore((s) => s.setDevices)
  const devices = useVoiceStore((s) => s.devices)
  const deviceId = useVoiceStore((s) => s.deviceId)
  const setDevice = useVoiceStore((s) => s.setDevice)
  const serviceId = useVoiceStore((s) => s.serviceId)
  const setService = useVoiceStore((s) => s.setService)
  const showDialog = useUiStore((s) => s.showDialog)
  const modelByService = useVoiceStore((s) => s.modelByService)
  const installedModels = useVoiceStore((s) => s.installedModels)
  const refreshModels = useVoiceStore((s) => s.refreshModels)
  const ringRef = useRef<HTMLSpanElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const listening = status === 'listening'
  const busy = status === 'transcribing' || status === 'starting'

  // Device labels are blank until the microphone has been granted once, so the
  // list is re-read after a dictation as well as on mount.
  useEffect(() => {
    const refresh = (): void => { void listInputDevices().then(setDevices) }
    refresh()
    return onDevicesChanged(refresh)
  }, [setDevices, status])

  useEffect(() => { void refreshModels() }, [refreshModels, status])

  useEffect(() => {
    if (!listening) return
    let frame = 0
    const tick = (): void => {
      const level = useVoiceStore.getState().level
      const node = ringRef.current
      if (node) {
        // Square-root: speech sits low in a linear scale, and a meter that
        // barely moves for ordinary speaking reads as a microphone that is not
        // picking anything up.
        const scale = 1 + Math.min(1, Math.sqrt(level) * 1.8) * 0.9
        node.style.transform = `scale(${scale})`
        node.style.opacity = String(0.25 + Math.min(1, Math.sqrt(level) * 1.5) * 0.5)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [listening])

  const toggle = (): void => {
    if (listening) { void stopDictation(); return }
    if (busy) return
    // The on-device engine cannot transcribe anything until its model is on
    // disk. Opening the picker is the useful answer to a click; an error
    // saying "no model" would make the user go and find this dialog anyway.
    const service = resolveService(serviceId)
    if (service.kind === 'on-device') {
      const model = modelByService[BUILTIN_WHISPER_ID] ?? service.defaultModel
      if (!installedModels.includes(model)) { showDialog('voice-model'); return }
    }
    void startDictation({ onTranscript })
  }

  const menuItems: ContextMenuItem[] = [
    { label: 'Microphone', disabled: true },
    ...devices.map((d) => ({
      label: `${deviceId === d.deviceId ? '• ' : '  '}${d.label}`,
      onClick: () => setDevice(d.deviceId),
    })),
    { separator: true } as ContextMenuItem,
    { label: 'Transcribed by', disabled: true },
    ...serviceList().map((s) => ({
      label: `${serviceId === s.id ? '• ' : '  '}${s.label}`,
      onClick: () => setService(s.id),
    })),
    { separator: true } as ContextMenuItem,
    { label: 'Speech model…', onClick: () => showDialog('voice-model') },
    { label: 'Voice settings…', onClick: () => showDialog('settings') },
  ]

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className={cn('relative h-6 px-2', listening ? 'text-geo-accent' : 'text-geo-muted hover:text-foreground')}
        disabled={disabled || busy}
        onClick={toggle}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
        title={listening
          ? 'Listening — click to stop, right-click to change microphone'
          : `Dictate a message (${resolveService(serviceId).label}). Right-click for the microphone and service.`}
        data-ourgeo-id="ai.voice"
      >
        {listening && (
          <span
            ref={ringRef}
            aria-hidden
            className="absolute inset-0 m-auto h-4 w-4 rounded-full bg-geo-accent/40 pointer-events-none"
            style={{ transform: 'scale(1)' }}
          />
        )}
        {status === 'transcribing' ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : status === 'error' ? (
          <MicOff className="w-3 h-3 text-geo-error relative" />
        ) : (
          <Mic className={cn('w-3 h-3 relative', listening && 'fill-geo-accent')} />
        )}
      </Button>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </>
  )
}

/** The recording timer and cancel, shown beside the composer while listening. */
export function VoiceStatusLine(): React.ReactElement | null {
  const status = useVoiceStore((s) => s.status)
  const error = useVoiceStore((s) => s.error)
  const partial = useVoiceStore((s) => s.partial)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (status !== 'listening') { setElapsed(0); return }
    // Once a second, from the store — the level updates fifty times a second
    // and nothing here needs that.
    const id = setInterval(() => setElapsed(Math.floor(useVoiceStore.getState().seconds)), 500)
    return () => clearInterval(id)
  }, [status])

  if (status === 'error' && error) {
    return <p className="text-[11px] text-geo-error px-1">{error}</p>
  }
  if (status === 'listening') {
    return (
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11px] text-geo-accent">
          Listening… {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
        </span>
        <button
          className="text-[10px] text-geo-muted hover:text-foreground"
          onClick={() => void cancelDictation()}
        >
          Cancel
        </button>
        {partial && <span className="text-[11px] text-geo-muted italic truncate">{partial}</span>}
      </div>
    )
  }
  if (status === 'transcribing') {
    return <p className="text-[11px] text-geo-muted px-1">Transcribing…</p>
  }
  return null
}
