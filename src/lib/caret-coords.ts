/**
 * Compute the viewport rectangle of the caret at `position` inside a textarea,
 * using the well-known mirror-div technique: a hidden div is styled to match
 * the textarea, filled with the text up to the caret, and a marker span is
 * measured. Returns viewport-relative coords suitable for `position: fixed`.
 */
export function getTextareaCaretRect(
  el: HTMLTextAreaElement,
  position: number
): { left: number; top: number; height: number } {
  const div = document.createElement('div')
  const style = div.style
  const computed = window.getComputedStyle(el)

  style.position = 'absolute'
  style.visibility = 'hidden'
  style.whiteSpace = 'pre-wrap'
  style.wordWrap = 'break-word'
  style.overflow = 'hidden'

  const props = [
    'boxSizing',
    'width',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'letterSpacing',
    'lineHeight',
    'textTransform',
    'textIndent',
  ] as const
  for (const p of props) style[p as never] = computed[p as never]
  style.width = `${el.clientWidth}px`

  div.textContent = el.value.slice(0, position)
  const span = document.createElement('span')
  span.textContent = el.value.slice(position) || '.'
  div.appendChild(span)
  document.body.appendChild(div)

  const rect = el.getBoundingClientRect()
  const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.2
  const left = rect.left + (span.offsetLeft - el.scrollLeft)
  const top = rect.top + (span.offsetTop - el.scrollTop)

  document.body.removeChild(div)
  return { left, top, height: lineHeight }
}
