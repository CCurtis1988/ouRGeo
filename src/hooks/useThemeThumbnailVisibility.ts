import { useEffect, useRef, useState } from 'react'

const waiting = new Map<Element, () => void>()
let observer: IntersectionObserver | undefined

/** Native image lazy-loading cannot defer the fetch needed to freeze a GIF's
 * first frame. Wait until a card approaches the scroll viewport before mounting
 * its poster hook, sharing one observer across even a large folder gallery. */
export function useThemeThumbnailVisibility(): { ref: React.RefObject<HTMLButtonElement>; visible: boolean } {
  const ref = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const element = ref.current
    if (visible || !element || typeof IntersectionObserver === 'undefined') return
    observer ??= new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        waiting.get(entry.target)?.()
        waiting.delete(entry.target)
        observer?.unobserve(entry.target)
      }
    }, { rootMargin: '200px' })
    waiting.set(element, () => setVisible(true))
    observer.observe(element)
    return () => {
      waiting.delete(element)
      observer?.unobserve(element)
      if (!waiting.size) { observer?.disconnect(); observer = undefined }
    }
  }, [visible])
  return { ref, visible }
}
