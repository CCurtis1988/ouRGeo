import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { RObjectInfo, REnvironmentInfo } from '@/lib/r-client'
import { EnvironmentItem } from './EnvironmentItem'

interface TypeGroupProps {
  typeName: string
  objects: RObjectInfo[]
  envName: string
  allEnvironments: REnvironmentInfo[]
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
  env: REnvironmentInfo
  allEnvironments: REnvironmentInfo[]
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

  const query = searchQuery.toLowerCase()
  const filteredObjects = query
    ? env.objects.filter((o) => o.name.toLowerCase().includes(query))
    : env.objects

  if (query && filteredObjects.length === 0) return <></>

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
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-geo-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-geo-muted flex-shrink-0" />
        )}
        <span className="text-[10px] text-geo-muted truncate">{env.name}</span>
        <span className="text-[10px] text-geo-muted ml-auto flex-shrink-0">
          {filteredObjects.length}
        </span>
      </button>
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
    </div>
  )
}
