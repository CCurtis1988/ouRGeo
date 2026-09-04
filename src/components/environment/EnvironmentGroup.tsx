import React, { useRef, useState, useEffect } from 'react'
import { Boxes, ChevronDown, ChevronRight, Globe } from 'lucide-react'
import type { RObjectInfo } from '@/lib/r-client'
import { rClient } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import { DEFAULT_PLACEMENT, duplicateCode, GLOBAL_ENV, type PanelEnv } from '@/lib/environments'
import { placementMenu, workHereItem } from './env-menu'
import { exportEnvironments } from '@/lib/env-export'
import { ContextMenu, type ContextMenuItem } from '../ui/context-menu'
import { EnvironmentItem } from './EnvironmentItem'
import { cn } from '@/lib/utils'

interface TypeGroupProps {
  typeName: string
  objects: RObjectInfo[]
  envName: string
  allEnvironments: PanelEnv[]
  onRefresh: () => void
  defaultExpanded?: boolean
}

function TypeGroup({
  typeName,
  objects,
  envName,
  allEnvironments,
  onRefresh,
  defaultExpanded = true
}: TypeGroupProps): React.ReactElement {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div>
      <button
        className="flex items-center gap-1 w-full pl-5 pr-2 py-0.5 hover:bg-geo-bg/50 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="w-2.5 h-2.5 text-geo-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-2.5 h-2.5 text-geo-muted flex-shrink-0" />
        )}
        <span className="text-[10px] text-geo-accent truncate">{typeName}</span>
        <span className="text-[10px] text-geo-muted ml-auto flex-shrink-0">{objects.length}</span>
      </button>
      {expanded &&
        objects.map((obj) => (
          <EnvironmentItem
            key={obj.name}
            obj={obj}
            envName={envName}
            allEnvironments={allEnvironments}
            onRefresh={onRefresh}
          />
        ))}
    </div>
  )
}

interface EnvironmentGroupProps {
  env: PanelEnv
  allEnvironments: PanelEnv[]
  searchQuery: string
  onRefresh: () => void
  defaultExpanded?: boolean
}

export function EnvironmentGroup({
  env,
  allEnvironments,
  searchQuery,
  onRefresh,
  defaultExpanded = false
}: EnvironmentGroupProps): React.ReactElement {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // 'copy' and 'rename' both collect one name, in the same place, so they share
  // an input rather than each growing their own.
  const [prompt, setPrompt] = useState<{ kind: 'copy' | 'rename'; value: string } | null>(null)
  const promptRef = useRef<HTMLInputElement>(null)
  const placement = env.placement ?? DEFAULT_PLACEMENT

  useEffect(() => { if (prompt) promptRef.current?.focus() }, [prompt])

  const log = (cmd: string): void => useSessionStore.getState().addConsoleEntry('input', cmd)
  const fail = (msg: string): void => useSessionStore.getState().addConsoleEntry('error', msg)

  const handleDuplicate = async (newName: string): Promise<void> => {
    const name = newName.trim()
    if (!name) return
    setPrompt(null)
    // Echoed before the call so the console reads in the order things happened,
    // and echoed as list2env because that is what the server does: `copy <- env`
    // would be a second name for the same environment, not a copy of it.
    log(duplicateCode(env.name, name, env.parentEnv ?? '.GlobalEnv'))
    const res = await rClient.envDuplicate(env.name, name, env.parentEnv ?? '.GlobalEnv')
    if (!res.success) { fail(res.error ?? `Could not copy ${env.name}.`); return }
    onRefresh()
  }

  const handleRename = async (newName: string): Promise<void> => {
    const name = newName.trim()
    if (!name || name === env.name) { setPrompt(null); return }
    setPrompt(null)
    log(`${name} <- ${env.name}; rm("${env.name}", envir = .GlobalEnv)`)
    const res = await rClient.envRename(env.name, name, '.GlobalEnv')
    if (!res.success) { fail(res.error ?? `Could not rename ${env.name}.`); return }
    onRefresh()
  }

  const handleDelete = async (): Promise<void> => {
    const n = env.objects.length
    const ok = window.confirm(
      `Delete the environment "${env.name}"${n > 0 ? ` and the ${n} object${n === 1 ? '' : 's'} in it` : ''}? ` +
      'This cannot be undone — export it first if you want to keep a copy.',
    )
    if (!ok) return
    log(`rm("${env.name}", envir = .GlobalEnv)`)
    const res = await rClient.envRemove(env.name, '.GlobalEnv')
    if (!res.success) { fail(res.error ?? `Could not remove ${env.name}.`); return }
    onRefresh()
  }

  // Export is offered for every environment — a package's contents are a
  // legitimate thing to snapshot. The rest are the user's own environments
  // only: three of them write to .GlobalEnv (renaming `package:stats` is not a
  // thing, and copying one would drop several hundred functions into the global
  // environment), and Show is about an environment the user made.
  // Export is offered for every environment — a package's contents are a
  // legitimate thing to snapshot. The rest are the user's own environments
  // only: renaming `package:stats` is not a thing, and copying one would drop
  // several hundred functions into the global environment.
  const menuItems: ContextMenuItem[] = [
    // Working inside it is first because it is the thing a user most often
    // wants an environment FOR — R will not find `x` in `env2` from a
    // .GlobalEnv prompt, and this is the answer to that.
    ...(env.isUserEnv || env.name === GLOBAL_ENV ? [workHereItem(env.name)] : []),
    { label: 'Export…', onClick: () => void exportEnvironments([env.name]) },
    ...(env.isUserEnv
      ? [
          // The way to a row inside .GlobalEnv. It is the same menu the row
          // itself carries, so the trip is reversible from either end.
          placementMenu(env.name, placement),
          { label: 'Make Copy', onClick: () => setPrompt({ kind: 'copy', value: `${env.name}_copy` }) },
          { label: 'Rename', onClick: () => setPrompt({ kind: 'rename', value: env.name }) },
          { separator: true } as ContextMenuItem,
          { label: 'Delete Environment', onClick: () => void handleDelete() },
        ]
      : []),
  ]

  const query = searchQuery.toLowerCase()
  // Searching for an environment by NAME finds the environment. It used to
  // find it for free, when a user environment was a row in .GlobalEnv like any
  // other object; promoting it to a group of its own would otherwise have made
  // it the one thing in the panel that search could not reach.
  const nameHit = query.length > 0 && env.name.toLowerCase().includes(query)
  const filteredObjects = query && !nameHit
    ? env.objects.filter((o) => o.name.toLowerCase().includes(query))
    : env.objects

  if (query && !nameHit && filteredObjects.length === 0) return <></>

  // Group objects by class
  const typeGroups = new Map<string, RObjectInfo[]>()
  for (const obj of filteredObjects) {
    const key = obj.class
    if (!typeGroups.has(key)) typeGroups.set(key, [])
    typeGroups.get(key)!.push(obj)
  }

  // Sort type groups alphabetically
  const sortedTypes = Array.from(typeGroups.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  )

  return (
    <div>
      <button
        className="flex items-center gap-1 w-full px-2 py-1 hover:bg-geo-bg/50 text-left"
        onClick={() => setExpanded(!expanded)}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
        // The environment a user made is a place, but it is also an object in
        // .GlobalEnv, and `myenv$roads` is how its contents are named in code.
        // The tooltip says so, because the panel's layout no longer does.
        title={env.isUserEnv
          ? `${env.name} — an environment in ${env.parentEnv ?? GLOBAL_ENV}, listed here as a place of its own; `
            + `its objects are ${env.name}$name`
          : env.name === GLOBAL_ENV
            ? '.GlobalEnv — R\u2019s global environment, where your work lives'
            : env.name}
        data-ourgeo-id={`environment.group.${env.name}`}
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-geo-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-geo-muted flex-shrink-0" />
        )}
        {/* A group is either .GlobalEnv or an environment the user asked to
            keep beside it. A child environment has no group at all — it is the
            row inside .GlobalEnv, which carries the single-box icon. */}
        {env.name === GLOBAL_ENV ? (
          <Globe className="w-2.5 h-2.5 text-geo-accent flex-shrink-0" aria-label="The global environment" />
        ) : env.isUserEnv ? (
          <Boxes className="w-2.5 h-2.5 text-geo-accent flex-shrink-0" aria-label="Environment, beside .GlobalEnv" />
        ) : null}
        <span className={cn('text-[10px] truncate', env.isUserEnv ? 'text-foreground' : 'text-geo-muted')}>
          {env.name}
        </span>
        <span className="text-[10px] text-geo-muted ml-auto flex-shrink-0">
          {filteredObjects.length}
        </span>
      </button>

      {prompt && (
        <div className="px-2 py-1">
          <input
            ref={promptRef}
            className="bg-geo-bg border border-geo-border rounded px-1.5 py-0.5 text-xs text-foreground outline-none w-full"
            value={prompt.value}
            onChange={(e) => setPrompt({ ...prompt, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void (prompt.kind === 'copy' ? handleDuplicate(prompt.value) : handleRename(prompt.value))
              }
              if (e.key === 'Escape') setPrompt(null)
            }}
            onBlur={() => setPrompt(null)}
          />
          <div className="text-[10px] text-geo-muted mt-0.5">
            {prompt.kind === 'copy'
              ? 'Name for the copy — its objects are copied, not shared.'
              : 'New name for this environment.'}
          </div>
        </div>
      )}
      {expanded &&
        (sortedTypes.length === 1 ? (
          // If only one type, skip the type group header
          sortedTypes[0][1].map((obj) => (
            <EnvironmentItem
              key={obj.name}
              obj={obj}
              envName={env.name}
              allEnvironments={allEnvironments}
              onRefresh={onRefresh}
            />
          ))
        ) : (
          sortedTypes.map(([typeName, objects]) => (
            <TypeGroup
              key={typeName}
              typeName={typeName}
              objects={objects}
              envName={env.name}
              allEnvironments={allEnvironments}
              onRefresh={onRefresh}
            />
          ))
        ))}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
