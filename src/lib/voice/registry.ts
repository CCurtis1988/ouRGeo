// The transcription services, live.
//
// Shaped like `api-connectors/registry.ts` — a shipped list read through a
// function rather than imported directly — but deliberately NOT plugin-
// extensible yet. Nothing asks for a contributed transcription service, and a
// registration path with no caller is a guess about what one would need. The
// indirection is what makes adding that later a change to this file alone.

import type { TranscriptionService } from './types'
import { openAiCompatibleService } from './services/openai-compatible'
import { builtinWhisperService, BUILTIN_WHISPER_ID } from './services/builtin-whisper'

const BUILTIN: TranscriptionService[] = [
  builtinWhisperService,
  openAiCompatibleService,
]

export const BUILTIN_SERVICES: readonly TranscriptionService[] = BUILTIN

const live: TranscriptionService[] = BUILTIN

/**
 * The service used when the user has never chosen one.
 *
 * The on-device engine, because it is the only one that works with no account,
 * no key and no server — the first dictation should not begin with a form.
 */
export const DEFAULT_SERVICE_ID = BUILTIN_WHISPER_ID

export function serviceList(): TranscriptionService[] {
  return live
}

export function serviceById(id: string): TranscriptionService | undefined {
  return live.find((s) => s.id === id)
}

/**
 * Resolve a stored id to a service that still exists.
 *
 * A preferences file naming a service that has since been removed must not
 * leave the panel with no way to transcribe anything — it falls back to the
 * default rather than refusing.
 */
export function resolveService(id: string): TranscriptionService {
  return serviceById(id) ?? serviceById(DEFAULT_SERVICE_ID) ?? BUILTIN[0]
}

/** Services grouped for a picker: on-device first, then local, then cloud. */
export function servicesByKind(): { kind: string; label: string; services: TranscriptionService[] }[] {
  const groups: { kind: string; label: string }[] = [
    { kind: 'on-device', label: 'On this machine' },
    { kind: 'local-server', label: 'A server you run' },
    { kind: 'cloud', label: 'Cloud services' },
  ]
  return groups
    .map((g) => ({ ...g, services: live.filter((s) => s.kind === g.kind) }))
    .filter((g) => g.services.length > 0)
}
