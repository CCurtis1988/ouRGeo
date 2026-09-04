import React, { useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { useVoiceStore } from '@/store/voice'
import { useApiKeysStore } from '@/store/apiKeys'
import { listInputDevices, onDevicesChanged, stillPresent } from '@/lib/voice/devices'
import { resolveService, servicesByKind } from '@/lib/voice/registry'
import { activeDevice, BUILTIN_WHISPER_ID } from '@/lib/voice/services/builtin-whisper'
import { useUiStore } from '@/store/ui'
import { VoiceCapture } from '@/lib/voice/capture'
import { SecretField, UrlField } from './fields'
import { cn } from '@/lib/utils'

// A short list rather than every ISO code: these are the ones a picker is
// useful for, and "detect" is the right default for everyone else.
const LANGUAGES: { id: string; label: string }[] = [
  { id: '', label: 'Detect automatically' },
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'es', label: 'Spanish' },
  { id: 'pt', label: 'Portuguese' },
  { id: 'it', label: 'Italian' },
  { id: 'nl', label: 'Dutch' },
  { id: 'zh', label: 'Chinese' },
  { id: 'ja', label: 'Japanese' },
]

/**
 * A meter that opens the microphone on demand.
 *
 * Testing a microphone by dictating into the AI panel and reading back what it
 * heard is a slow way to find out you picked the wrong device. This is the
 * fast way, and it uses the same capture path as a real dictation — so a
 * device that works here works there.
 *
 * It holds the microphone only while it is running, never for the whole time
 * Settings happens to be open.
 */
function DeviceTest({ deviceId }: { deviceId: string }): React.ReactElement {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const captureRef = useRef<VoiceCapture | null>(null)
  const levelRef = useRef(0)

  useEffect(() => () => { void captureRef.current?.cancel() }, [])

  useEffect(() => {
    if (!running) return
    let frame = 0
    const tick = (): void => {
      if (barRef.current) {
        barRef.current.style.width = `${Math.min(100, Math.sqrt(levelRef.current) * 140)}%`
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running])

  const toggle = async (): Promise<void> => {
    if (running) {
      await captureRef.current?.cancel()
      captureRef.current = null
      levelRef.current = 0
      if (barRef.current) barRef.current.style.width = '0%'
      setRunning(false)
      return
    }
    setError(null)
    const capture = new VoiceCapture()
    captureRef.current = capture
    try {
      await capture.start(deviceId || undefined, {
        onLevel: (level) => { levelRef.current = level },
        onFrame: () => {},
        onEnd: () => setRunning(false),
      })
      setRunning(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The microphone could not be opened.')
      captureRef.current = null
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          className={cn(
            'flex items-center gap-1 text-[11px] px-2 py-1 rounded border',
            running
              ? 'border-geo-accent text-geo-accent'
              : 'border-geo-border text-geo-muted hover:text-foreground',
          )}
          onClick={() => void toggle()}
          data-ourgeo-id="settings.voiceTest"
        >
          {running ? <Square className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
          {running ? 'Stop test' : 'Test microphone'}
        </button>
        <div className="flex-1 h-1.5 bg-geo-bg rounded overflow-hidden border border-geo-border">
          <div ref={barRef} className="h-full bg-geo-accent transition-[width] duration-75" style={{ width: '0%' }} />
        </div>
      </div>
      {error
        ? <p className="text-[11px] text-geo-error">{error}</p>
        : <p className="text-[11px] text-geo-muted">
            {running ? 'Say something — the bar should move.' : 'Check the right microphone is picked up before dictating.'}
          </p>}
    </div>
  )
}

export function VoiceSettings(): React.ReactElement {
  const devices = useVoiceStore((s) => s.devices)
  const setDevices = useVoiceStore((s) => s.setDevices)
  const deviceId = useVoiceStore((s) => s.deviceId)
  const setDevice = useVoiceStore((s) => s.setDevice)
  const serviceId = useVoiceStore((s) => s.serviceId)
  const setService = useVoiceStore((s) => s.setService)
  const modelByService = useVoiceStore((s) => s.modelByService)
  const setModel = useVoiceStore((s) => s.setModel)
  const language = useVoiceStore((s) => s.language)
  const setLanguage = useVoiceStore((s) => s.setLanguage)
  const autoSend = useVoiceStore((s) => s.autoSend)
  const setAutoSend = useVoiceStore((s) => s.setAutoSend)
  const silenceStopMs = useVoiceStore((s) => s.silenceStopMs)
  const setSilenceStopMs = useVoiceStore((s) => s.setSilenceStopMs)
  const keys = useApiKeysStore((s) => s.keys)
  const installedModels = useVoiceStore((s) => s.installedModels)
  const refreshModels = useVoiceStore((s) => s.refreshModels)
  const showDialog = useUiStore((s) => s.showDialog)

  useEffect(() => {
    const refresh = (): void => { void listInputDevices().then(setDevices) }
    refresh()
    void refreshModels()
    return onDevicesChanged(refresh)
  }, [setDevices, refreshModels])

  const service = resolveService(serviceId)
  const configError = service.configError(keys)
  const unnamed = devices.some((d) => !d.named)
  const missing = !stillPresent(devices, deviceId)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-foreground">Input device</span>
        <select
          value={deviceId}
          onChange={(e) => setDevice(e.target.value)}
          className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
          data-ourgeo-id="settings.voiceDevice"
        >
          {devices.map((d) => (
            <option key={d.deviceId || 'default'} value={d.deviceId}>{d.label}</option>
          ))}
          {missing && <option value={deviceId}>Previously chosen microphone (not connected)</option>}
        </select>
        {unnamed && (
          <p className="text-[11px] text-geo-muted">
            Microphone names appear once ouRGeo has been allowed to use one — dictate once, or run the test below.
          </p>
        )}
      </div>

      <DeviceTest deviceId={deviceId} />

      <div className="flex flex-col gap-1">
        <span className="text-xs text-foreground">Transcribed by</span>
        <select
          value={serviceId}
          onChange={(e) => setService(e.target.value)}
          className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
          data-ourgeo-id="settings.voiceService"
        >
          {servicesByKind().map((group) => (
            <optgroup key={group.kind} label={group.label}>
              {group.services.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="text-[11px] text-geo-muted">{service.description}</p>
        {configError && <p className="text-[11px] text-geo-error">{configError}</p>}
      </div>

      {service.urlKeyId && service.defaultUrl && (
        <UrlField id={service.urlKeyId} placeholder={service.defaultUrl} />
      )}
      {service.apiKeyId && (
        <SecretField
          id={service.apiKeyId}
          label="API key"
          description={service.kind === 'cloud'
            ? `Required by ${service.label}. Audio is uploaded to them, and the console records each time it is.`
            : 'Leave blank for a server you run yourself, which usually needs none.'}
          placeholder={service.kind === 'cloud' ? 'Paste the key' : 'sk-… (optional)'}
        />
      )}

      {service.kind === 'on-device' && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-foreground">Speech model</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-geo-muted flex-1">
              {installedModels.length === 0
                ? 'No model downloaded yet — the first dictation will offer one.'
                : `Downloaded: ${installedModels.join(', ')}. Using ${modelByService[BUILTIN_WHISPER_ID] ?? service.defaultModel}.`}
              {activeDevice() && ` Running on ${activeDevice() === 'webgpu' ? 'the GPU' : 'the CPU'}.`}
            </span>
            <button
              className="text-[11px] text-geo-accent hover:text-foreground px-2 py-1 border border-geo-border rounded"
              onClick={() => showDialog('voice-model')}
              data-ourgeo-id="settings.voiceModels"
            >
              Manage models…
            </button>
          </div>
        </div>
      )}

      {service.models.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-foreground">Model</span>
          <select
            value={modelByService[service.id] ?? service.defaultModel}
            onChange={(e) => setModel(service.id, e.target.value)}
            className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
          >
            {service.models.map((m) => (
              <option key={m.id} value={m.id}>{m.note ? `${m.label} — ${m.note}` : m.label}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-xs text-foreground">Language</span>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
        >
          {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-foreground">Stop listening after silence</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={30}
            step={0.5}
            value={silenceStopMs / 1000}
            onChange={(e) => setSilenceStopMs(Math.round(Number(e.target.value) * 1000))}
            className="w-20 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
          />
          <span className="text-[11px] text-geo-muted">seconds — 0 to keep listening until you click again</span>
        </div>
      </div>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={autoSend}
          onChange={(e) => setAutoSend(e.target.checked)}
          className="accent-geo-accent w-3 h-3 mt-0.5"
          data-ourgeo-id="settings.voiceAutoSend"
        />
        <span className="flex flex-col">
          <span className="text-xs text-foreground">Send as soon as the transcript arrives</span>
          <span className="text-[11px] text-geo-muted">
            Off by default. The assistant can run R, and a misheard instruction is worth reading before it goes.
          </span>
        </span>
      </label>
    </div>
  )
}
