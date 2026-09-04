import React, { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useApiKeysStore } from '@/store/apiKeys'

// The two field components every "configure a service" section needs.
//
// They lived inside `AiProviderSettings.tsx` until voice input needed the same
// pair for transcription services. Lifting them rather than copying keeps one
// answer to how a key is masked and where it is stored — the same reasoning as
// `add-spatial-layer.ts` and `map-export.ts`.

/** A masked credential, stored in `api-keys.json` under `id`. */
export function SecretField({ id, label, description, placeholder }: {
  id: string; label: string; description: string; placeholder: string
}): React.ReactElement {
  const value = useApiKeysStore((s) => s.keys[id] ?? '')
  const setKey = useApiKeysStore((s) => s.setKey)
  const [show, setShow] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-foreground">{label}</span>
      <p className="text-[11px] text-geo-muted">{description}</p>
      <div className="flex items-center gap-1">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => setKey(id, e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent font-mono"
        />
        <button
          className="text-geo-muted hover:text-foreground p-1"
          onClick={() => setShow((v) => !v)}
          title={show ? 'Hide' : 'Show'}
        >
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  )
}

/**
 * Plain (non-secret) text field for base URLs, pre-filled with the system
 * default as a placeholder so the user sees what will be used when left blank.
 */
export function UrlField({ id, placeholder, label = 'Base URL' }: {
  id: string; placeholder: string; label?: string
}): React.ReactElement {
  const value = useApiKeysStore((s) => s.keys[id] ?? '')
  const setKey = useApiKeysStore((s) => s.setKey)
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-foreground">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => setKey(id, e.target.value)}
        placeholder={placeholder}
        className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent font-mono"
      />
      <p className="text-[11px] text-geo-muted">Default if blank: <span className="font-mono">{placeholder}</span></p>
    </div>
  )
}
