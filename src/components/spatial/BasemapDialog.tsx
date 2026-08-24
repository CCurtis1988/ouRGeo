import React, { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Lock, Check, CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { useBasemapStore } from '@/store/basemap'
import { useThemeStore } from '@/store/theme'
import { useApiKeysStore } from '@/store/apiKeys'
import {
  FREE_BASEMAPS,
  API_BASEMAPS,
  THEME_DEFAULT_BASEMAPS,
  type BasemapDef,
} from '@/lib/basemaps'
import { cn } from '@/lib/utils'

interface BasemapDialogProps {
  open: boolean
  onClose: () => void
}

function GroupHeader({ name }: { name: string }) {
  return (
    <p className="text-[10px] font-semibold text-geo-muted uppercase tracking-wider mb-2 mt-3 first:mt-0">
      {name}
    </p>
  )
}

function BasemapCard({
  def,
  active,
  locked,
  onClick,
}: {
  def: BasemapDef
  active: boolean
  locked: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={locked}
      className={cn(
        'group relative rounded-lg overflow-hidden border-2 transition-all text-left w-full',
        active ? 'border-geo-accent ring-1 ring-geo-accent/30' : 'border-transparent',
        locked ? 'opacity-60 cursor-default' : 'hover:border-geo-border cursor-pointer'
      )}
    >
      {/* Thumbnail */}
      <div className="relative h-16 bg-geo-bg overflow-hidden">
        <div className="absolute inset-0" style={{ background: def.previewBg }} />
        {def.previewUrl && (
          <img
            src={def.previewUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}
        {locked && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <Lock className="w-4 h-4 text-white/70" />
          </div>
        )}
        {active && (
          <div className="absolute top-1 right-1 w-4 h-4 bg-geo-accent rounded-full flex items-center justify-center">
            <Check className="w-2.5 h-2.5 text-white" />
          </div>
        )}
      </div>
      {/* Label */}
      <div className="px-1.5 py-1.5 bg-geo-panel">
        <p className="text-[10px] font-medium text-foreground truncate leading-tight">{def.name}</p>
        <p className="text-[9px] text-geo-muted truncate">{def.provider}</p>
      </div>
    </button>
  )
}

function ProviderGroup({
  name,
  defs,
  activeId,
  apiKeyId,
  onSelect,
}: {
  name: string
  defs: BasemapDef[]
  activeId: string
  apiKeyId: string
  onSelect: (id: string) => void
}) {
  const key = useApiKeysStore((s) => s.keys[apiKeyId] ?? '')
  const setKey = useApiKeysStore((s) => s.setKey)
  const [keyInput, setKeyInput] = useState('')
  const [show, setShow] = useState(false)
  const hasKey = !!key

  return (
    <div className="mb-4">
      <GroupHeader name={name} />
      <div className="grid grid-cols-4 gap-2 mb-2">
        {defs.map((def) => (
          <BasemapCard
            key={def.id}
            def={def}
            active={activeId === def.id}
            locked={!hasKey}
            onClick={() => { if (hasKey) onSelect(def.id) }}
          />
        ))}
      </div>
      {!hasKey && (
        <div className="flex gap-2 items-center mt-1.5">
          <input
            type={show ? 'text' : 'password'}
            value={keyInput}
            placeholder={`Enter ${name} API key`}
            onChange={(e) => setKeyInput(e.target.value)}
            className="flex-1 bg-geo-bg border border-geo-border rounded px-2 py-1.5
              text-xs text-foreground font-mono focus:outline-none focus:border-geo-accent"
          />
          <button
            onClick={() => setShow((v) => !v)}
            className="text-geo-muted hover:text-foreground p-1"
          >
            {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => { if (keyInput.trim()) setKey(apiKeyId, keyInput.trim()) }}
            disabled={!keyInput.trim()}
            className="px-3 py-1.5 text-xs bg-geo-accent/20 text-geo-accent rounded
              hover:bg-geo-accent/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Connect
          </button>
        </div>
      )}
      {hasKey && (
        <p className="text-[10px] text-geo-success flex items-center gap-1 mt-1">
          <CheckCircle2 className="w-3 h-3" /> Connected
        </p>
      )}
    </div>
  )
}

const CARTO_DEFS = FREE_BASEMAPS.filter((b) => b.provider === 'CARTO')
const OFM_DEFS = FREE_BASEMAPS.filter((b) => b.provider === 'OpenFreeMap')
const STREETS_DEFS = FREE_BASEMAPS.filter((b) =>
  b.provider === 'OpenStreetMap' || b.provider === 'OpenTopoMap'
)
const ESRI_DEFS = FREE_BASEMAPS.filter((b) => b.provider === 'ESRI')
const NONE_DEF = FREE_BASEMAPS.filter((b) => b.id === 'none')
const MAPBOX_DEFS = API_BASEMAPS.filter((b) => b.category === 'mapbox')
const MAPTILER_DEFS = API_BASEMAPS.filter((b) => b.category === 'maptiler')
const STADIA_DEFS = API_BASEMAPS.filter((b) => b.category === 'stadia')

export function BasemapDialog({ open, onClose }: BasemapDialogProps): React.ReactElement {
  const overrideId = useBasemapStore((s) => s.overrideBasemapId)
  const setOverride = useBasemapStore((s) => s.setOverride)
  const currentTheme = useThemeStore((s) => s.current)

  const themeDefault = THEME_DEFAULT_BASEMAPS[currentTheme] ?? 'carto-dark-matter'
  const activeId = overrideId ?? themeDefault

  const handleSelect = (id: string) => {
    setOverride(id === themeDefault ? null : id)
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
            w-[680px] max-h-[85vh] overflow-y-auto
            bg-geo-panel border border-geo-border rounded-lg shadow-xl
            focus:outline-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-geo-border sticky top-0 bg-geo-panel z-10">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              Basemap
            </Dialog.Title>
            <Dialog.Close className="text-geo-muted hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="px-5 py-4">
            {/* Free basemaps section */}
            <p className="text-[11px] font-semibold text-geo-muted uppercase tracking-wider mb-3">
              Free Basemaps
            </p>

            <GroupHeader name="CARTO" />
            <div className="grid grid-cols-5 gap-2 mb-4">
              {CARTO_DEFS.map((def) => (
                <BasemapCard
                  key={def.id}
                  def={def}
                  active={activeId === def.id}
                  locked={false}
                  onClick={() => handleSelect(def.id)}
                />
              ))}
            </div>

            <GroupHeader name="OpenFreeMap" />
            <div className="grid grid-cols-5 gap-2 mb-4">
              {OFM_DEFS.map((def) => (
                <BasemapCard
                  key={def.id}
                  def={def}
                  active={activeId === def.id}
                  locked={false}
                  onClick={() => handleSelect(def.id)}
                />
              ))}
            </div>

            <GroupHeader name="Streets & Topography" />
            <div className="grid grid-cols-5 gap-2 mb-4">
              {STREETS_DEFS.map((def) => (
                <BasemapCard
                  key={def.id}
                  def={def}
                  active={activeId === def.id}
                  locked={false}
                  onClick={() => handleSelect(def.id)}
                />
              ))}
            </div>

            <GroupHeader name="ESRI" />
            <div className="grid grid-cols-5 gap-2 mb-4">
              {ESRI_DEFS.map((def) => (
                <BasemapCard
                  key={def.id}
                  def={def}
                  active={activeId === def.id}
                  locked={false}
                  onClick={() => handleSelect(def.id)}
                />
              ))}
            </div>

            <GroupHeader name="No Basemap" />
            <div className="grid grid-cols-5 gap-2 mb-4">
              {NONE_DEF.map((def) => (
                <BasemapCard
                  key={def.id}
                  def={def}
                  active={activeId === def.id}
                  locked={false}
                  onClick={() => handleSelect(def.id)}
                />
              ))}
            </div>

            <div className="h-px bg-geo-border my-4" />

            {/* API basemaps section */}
            <p className="text-[11px] font-semibold text-geo-muted uppercase tracking-wider mb-1">
              API Basemaps
            </p>
            <p className="text-[10px] text-geo-muted mb-4">
              Each provider requires a free API key. Keys are saved to Settings → API Keys.
            </p>

            <ProviderGroup
              name="Mapbox"
              defs={MAPBOX_DEFS}
              activeId={activeId}
              apiKeyId="mapbox"
              onSelect={handleSelect}
            />
            <ProviderGroup
              name="MapTiler"
              defs={MAPTILER_DEFS}
              activeId={activeId}
              apiKeyId="maptiler"
              onSelect={handleSelect}
            />
            <ProviderGroup
              name="Stadia Maps"
              defs={STADIA_DEFS}
              activeId={activeId}
              apiKeyId="stadia"
              onSelect={handleSelect}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
