import React, { useCallback } from 'react'
import { Loader2, Check } from 'lucide-react'
import { usePackagesStore } from '@/store/packages'
import { useSessionStore } from '@/store/session'
import { rClient } from '@/lib/r-client'
import { rStr } from '@/lib/r-identifier'

interface PackageItemProps {
  name: string
  version: string
  loaded: boolean
  isBase: boolean
  libPath: string
  onContextMenu: (name: string, libPath: string, x: number, y: number) => void
}

export function PackageItem({ name, version, loaded, isBase, libPath, onContextMenu }: PackageItemProps): React.ReactElement {
  const loadingPackages = usePackagesStore((s) => s.loadingPackages)
  const isToggling = loadingPackages.has(name)

  const handleToggle = useCallback(async () => {
    if (isBase || usePackagesStore.getState().loadingPackages.has(name)) return

    const { libraries, refreshPackages, addLoadingPackage, removeLoadingPackage } = usePackagesStore.getState()
    const newLoaded = !loaded
    const switching = newLoaded && libraries.some((lib) => lib.packages.some((pkg) =>
      pkg.name === name && pkg.loaded && (lib.path !== libPath || pkg.version !== version)))

    const addConsoleEntry = useSessionStore.getState().addConsoleEntry
    const command = newLoaded
      ? `${switching ? `unloadNamespace(${rStr(name)})\n` : ''}library(${rStr(name)}, lib.loc = ${rStr(libPath)})`
      : `unloadNamespace(${rStr(name)})`
    addConsoleEntry('input', command)

    addLoadingPackage(name)

    try {
      const res = newLoaded
        ? await rClient.loadPackage(name, libPath, version)
        : await rClient.unloadPackage(name, libPath, version)

      if (!res.success) {
        addConsoleEntry('error', res.error ?? `Failed to ${newLoaded ? 'load' : 'unload'} ${name}.`)
      }
    } catch (e) {
      addConsoleEntry('error', e instanceof Error ? e.message : String(e))
    } finally {
      // R may refuse a switch or a new copy may fail to load after the old
      // namespace was unloaded. Always show the state R actually ended with.
      await refreshPackages()
      removeLoadingPackage(name)
    }
  }, [name, version, libPath, loaded, isBase])

  return (
    <label
      className={`flex items-center gap-2 px-3 py-0.5 hover:bg-geo-bg/50 cursor-pointer select-none ${
        isBase ? 'opacity-60 cursor-default' : ''
      }`}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(name, libPath, e.clientX, e.clientY)
      }}
    >
      <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
        {isToggling ? (
          <Loader2 className="w-3 h-3 text-geo-accent animate-spin" />
        ) : (
          <div
            role="checkbox"
            aria-label={`${loaded ? 'Unload' : 'Load'} ${name} ${version} from ${libPath}`}
            aria-checked={loaded}
            aria-disabled={isBase || isToggling}
            tabIndex={isBase || isToggling ? -1 : 0}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); void handleToggle() } }}
            onClick={!isBase ? handleToggle : undefined}
            className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-colors ${
              loaded
                ? 'bg-geo-accent border-geo-accent'
                : 'border-geo-muted hover:border-foreground'
            } ${isBase ? '' : 'cursor-pointer'}`}
          >
            {loaded && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
          </div>
        )}
      </div>
      <span className="text-xs text-foreground truncate flex-1" onClick={!isBase ? handleToggle : undefined}>
        {name}
      </span>
      <span className="text-xs text-geo-muted flex-shrink-0">{version}</span>
    </label>
  )
}
