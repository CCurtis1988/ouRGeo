import React, { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Download, Trash2, X } from 'lucide-react'
import type { VoiceModelStatus } from '../../../electron/preload/types'
import { useUiStore } from '@/store/ui'
import { useVoiceStore } from '@/store/voice'
import { BUILTIN_WHISPER_ID, unloadWhisper } from '@/lib/voice/services/builtin-whisper'
import { cn } from '@/lib/utils'

// Choosing and downloading the on-device speech model.
//
// It is a dialog rather than a row in Settings because the choice is a real
// one — a 43 MB model that mishears place names against a 242 MB one that does
// not — and because it is the first thing a user meets when they dictate for
// the first time. Making that decision in a collapsed settings section, or
// making it silently on their behalf, are both worse than asking once.
//
// Sizes are the real download, measured from the files the engine actually
// fetches, not the size of the Hugging Face repository.

function mb(bytes: number): string {
  return `${Math.round(bytes / 1048576)} MB`
}

export function VoiceModelDialog(): React.ReactElement | null {
  const open = useUiStore((s) => s.openDialog) === 'voice-model'
  const hideDialog = useUiStore((s) => s.hideDialog)
  const chosen = useVoiceStore((s) => s.modelByService[BUILTIN_WHISPER_ID] ?? 'base.en')
  const setModel = useVoiceStore((s) => s.setModel)
  const refreshModels = useVoiceStore((s) => s.refreshModels)
  const [models, setModels] = useState<VoiceModelStatus[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    setModels(await window.electronAPI.voice.models().catch(() => []))
    await refreshModels()
  }

  useEffect(() => { if (open) void load() }, [open])   // eslint-disable-line react-hooks/exhaustive-deps

  const download = async (id: string): Promise<void> => {
    setBusy(id); setError(null); setProgress({ received: 0, total: 1 })
    const res = await window.electronAPI.voice.modelDownload(id, (p) => setProgress(p))
    setBusy(null); setProgress(null)
    if (!res.ok) { setError(res.error ?? 'The download did not finish.'); return }
    setModel(BUILTIN_WHISPER_ID, id)
    await load()
  }

  const remove = async (id: string): Promise<void> => {
    await window.electronAPI.voice.modelRemove(id)
    // The engine keeps the loaded model in memory; forgetting it here means
    // "remove" actually frees it rather than leaving it working until restart.
    unloadWhisper()
    await load()
  }

  if (!open) return null

  return (
    <Dialog.Root open onOpenChange={(v) => { if (!v) hideDialog('voice-model') }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] max-h-[80vh] overflow-auto bg-geo-panel border border-geo-border rounded-lg shadow-xl z-50 p-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <Dialog.Title className="text-sm font-semibold text-foreground">Speech model</Dialog.Title>
              <Dialog.Description className="text-[11px] text-geo-muted mt-0.5">
                Downloaded once and then used offline — nothing you dictate leaves this machine.
              </Dialog.Description>
            </div>
            <Dialog.Close className="text-geo-muted hover:text-foreground"><X className="w-4 h-4" /></Dialog.Close>
          </div>

          <div className="flex flex-col gap-1.5 mt-3">
            {models.map((m) => {
              const active = chosen === m.id
              const downloading = busy === m.id
              return (
                <div
                  key={m.id}
                  className={cn(
                    'border rounded px-3 py-2 flex flex-col gap-1',
                    active ? 'border-geo-accent bg-geo-accent/5' : 'border-geo-border',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-foreground">{m.label}</span>
                    <span className="text-[10px] text-geo-muted">{mb(m.totalBytes)}</span>
                    {m.installed && <Check className="w-3 h-3 text-geo-success" aria-label="Downloaded" />}
                    <div className="ml-auto flex items-center gap-1">
                      {m.installed ? (
                        <>
                          {!active && (
                            <button
                              className="text-[10px] text-geo-accent hover:text-foreground px-1.5 py-0.5"
                              onClick={() => setModel(BUILTIN_WHISPER_ID, m.id)}
                            >
                              Use this one
                            </button>
                          )}
                          <button
                            className="text-geo-muted hover:text-geo-error p-1"
                            title="Remove the downloaded model"
                            onClick={() => void remove(m.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      ) : downloading ? (
                        <button
                          className="text-[10px] text-geo-error hover:text-foreground px-1.5 py-0.5"
                          onClick={() => void window.electronAPI.voice.modelCancel(m.id)}
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          className="flex items-center gap-1 text-[10px] text-geo-accent hover:text-foreground px-1.5 py-0.5 disabled:opacity-40"
                          disabled={busy !== null}
                          onClick={() => void download(m.id)}
                          data-ourgeo-id={`voice.model.${m.id}`}
                        >
                          <Download className="w-3 h-3" />
                          Download
                        </button>
                      )}
                    </div>
                  </div>
                  <span className="text-[11px] text-geo-muted">{m.note}</span>
                  {downloading && progress && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-geo-bg rounded overflow-hidden border border-geo-border">
                        <div
                          className="h-full bg-geo-accent"
                          style={{ width: `${Math.min(100, (progress.received / Math.max(1, progress.total)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-geo-muted tabular-nums">
                        {mb(progress.received)} / {mb(progress.total)}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {error && <p className="text-[11px] text-geo-error mt-2">{error}</p>}
          <p className="text-[11px] text-geo-muted mt-3">
            Larger models are more accurate on names, places and R jargon. Without WebGPU they run
            single-threaded, so Small is noticeably slower than real time on an older machine.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
