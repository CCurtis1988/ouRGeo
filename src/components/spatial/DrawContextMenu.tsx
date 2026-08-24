import React from 'react'
import { ContextMenu } from '../ui/context-menu'
import { useDrawPreviewStore } from '@/store/drawPreview'

/** Renders the active drawing tool's right-click menu (opened by the ToolManager). */
export function DrawContextMenu(): React.ReactElement | null {
  const menu = useDrawPreviewStore((s) => s.contextMenu)
  const close = useDrawPreviewStore((s) => s.closeContextMenu)
  if (!menu) return null
  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={menu.items.map((i) => ({ label: i.label, onClick: i.onClick, disabled: i.disabled }))}
      onClose={close}
    />
  )
}
