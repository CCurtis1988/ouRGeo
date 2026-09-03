import { useEffect, useState, type RefObject } from 'react'

/** An element's content box, tracked. `{ w: 0, h: 0 }` until the first
 *  observation, which the caller must treat as "no ceiling known yet" rather
 *  than as a zero-width window. */
export function useElementSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const box = entry.contentRect
      setSize((prev) => (prev.w === box.width && prev.h === box.height
        ? prev                       // same box: don't re-render on every frame of a drag
        : { w: box.width, h: box.height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}
