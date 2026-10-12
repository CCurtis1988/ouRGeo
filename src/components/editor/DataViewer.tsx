import React from 'react'
import { type TabState } from '@/store/editor'
import { DataFrameView } from './DataFrameView'
import { MatrixView } from './MatrixView'
import { VectorView } from './VectorView'

// ---------- DataFrame / Matrix / Vector viewer ----------

export function DataViewer({ tab }: { tab: TabState }): React.ReactElement {
  const { objectName, envName, objectClass, accessPath } = tab
  const name = objectName || ''
  const env = envName || '.GlobalEnv'
  const path = accessPath || name
  const cls = objectClass || ''

  const isMatrix = cls === 'matrix'
  const isVector = ['numeric', 'character', 'integer', 'logical', 'factor', 'complex', 'units'].includes(cls)
  const isDataFrame = !isMatrix && !isVector

  if (isDataFrame) return <DataFrameView name={name} envName={env} accessPath={path} cls={cls} />
  if (isMatrix) return <MatrixView name={name} envName={env} accessPath={path} />
  return <VectorView name={name} envName={env} accessPath={path} cls={cls} tabId={tab.id} />
}
