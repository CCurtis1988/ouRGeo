// One divider drag, in one place.
//
// There used to be six of these, each ~20 lines of mousedown/mousemove/mouseup
// with its own clamps inlined. They are all the same gesture: remember where
// the pointer started and how big the thing was, then set a new size from the
// delta along one axis.
//
// The listeners go on `document`, not the divider, because the pointer leaves a
// 4px-wide element immediately and a drag that stops when you move fast is not
// a drag.

export type Axis = 'x' | 'y'

export interface DragResizeOptions {
  axis: Axis
  /** The size at the moment the drag starts. */
  from: number
  /** +1 when dragging along the axis should GROW the thing, -1 when it shrinks
   *  it. A right-hand divider grows the panel to its left and shrinks the one
   *  to its right; the sign is the only difference. */
  direction: 1 | -1
  min: number
  max: number
  onResize: (size: number) => void
}

/** Returns an onMouseDown handler that resizes while the button is held. */
export function startDragResize(
  { axis, from, direction, min, max, onResize }: DragResizeOptions,
) {
  return (e: React.MouseEvent): void => {
    e.preventDefault()
    const start = axis === 'x' ? e.clientX : e.clientY
    // The cursor and the no-select are on the body for the duration: without
    // them a drag across the editor selects text the whole way.
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent): void => {
      const now = axis === 'x' ? ev.clientX : ev.clientY
      const delta = (now - start) * direction
      onResize(Math.max(min, Math.min(max, from + delta)))
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
}
