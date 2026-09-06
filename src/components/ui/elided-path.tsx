import React, { useLayoutEffect, useRef, useState } from 'react'
import { elidePath } from '@/lib/working-dir'

/**
 * A path shortened to whatever width it is given.
 *
 * Measured against a canvas in the element's own font rather than left to CSS,
 * because `text-overflow: ellipsis` cuts the END off — and the end of a path is
 * the part that names the directory. The `direction: rtl` trick that truncates
 * the other way reorders the separators, which on a path is worse than either.
 *
 * Shared, because two headers show a directory — R's working directory in the
 * console and the shell's in the terminal — and they sit a few pixels apart in
 * the same strip. Two implementations there would read as two kinds of thing.
 */
export function ElidedPath({ path, className }: {
  path: string; className?: string
}): React.ReactElement {
  const boxRef = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [shown, setShown] = useState(path)

  // Laid out before paint, so the label never flashes at full width first.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) { setShown(path); return }
    const fit = (): void => {
      canvas.current ??= document.createElement('canvas')
      const ctx = canvas.current.getContext('2d')
      const available = box.clientWidth
      if (!ctx || available === 0) { setShown(path); return }
      const style = getComputedStyle(box)
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      setShown(elidePath(path, (c) => ctx.measureText(c).width <= available))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    return () => ro.disconnect()
  }, [path])

  // `flex-1` is load-bearing, not styling. Without it this box is sized by its
  // own text, so measuring it measures the elided string rather than the space
  // available — the label shrinks once and can never grow back, because the
  // ResizeObserver only ever sees the width the short text produced.
  return (
    <span
      ref={boxRef}
      className={`block min-w-0 flex-1 overflow-hidden whitespace-nowrap ${className ?? ''}`}
    >
      {shown}
    </span>
  )
}
