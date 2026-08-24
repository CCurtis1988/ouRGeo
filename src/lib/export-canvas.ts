import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

export interface CanvasExportOpts {
  widthPx: number
  heightPx: number
  dpi: number
  format: 'png' | 'jpg' | 'pdf'
  marginPx: number
}

/**
 * Capture the map container element (including WebGL canvas + HTML overlays)
 * and return a base64 data URI at the requested dimensions/format.
 *
 * Elements with [data-export-hide] are temporarily hidden during capture.
 */
export async function captureMapContainer(
  containerEl: HTMLElement,
  opts: CanvasExportOpts
): Promise<string> {
  const { widthPx, heightPx, dpi, format, marginPx } = opts

  // Hide UI controls that should not appear in export
  const hideEls = Array.from(
    containerEl.querySelectorAll<HTMLElement>('[data-export-hide]')
  )
  const prevVisibility = hideEls.map((el) => el.style.visibility)
  hideEls.forEach((el) => { el.style.visibility = 'hidden' })

  let rawCanvas: HTMLCanvasElement
  try {
    rawCanvas = await html2canvas(containerEl, {
      scale: dpi / 96,
      useCORS: true,
      allowTaint: false,
      backgroundColor: null,
      logging: false,
    })
  } finally {
    // Always restore visibility
    hideEls.forEach((el, i) => { el.style.visibility = prevVisibility[i] })
  }

  // Create output canvas at requested size
  const offscreen = document.createElement('canvas')
  offscreen.width = widthPx
  offscreen.height = heightPx
  const ctx = offscreen.getContext('2d')!
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, widthPx, heightPx)
  ctx.drawImage(
    rawCanvas,
    marginPx, marginPx,
    widthPx - marginPx * 2,
    heightPx - marginPx * 2
  )

  if (format === 'png') {
    return offscreen.toDataURL('image/png')
  }

  if (format === 'jpg') {
    return offscreen.toDataURL('image/jpeg', 0.92)
  }

  // PDF
  const wIn = widthPx / dpi
  const hIn = heightPx / dpi
  const orientation = wIn >= hIn ? 'landscape' : 'portrait'
  const doc = new jsPDF({
    orientation,
    unit: 'in',
    format: [wIn, hIn],
  })
  doc.addImage(offscreen.toDataURL('image/png'), 'PNG', 0, 0, wIn, hIn)
  return doc.output('datauristring')
}

/**
 * Strip the `data:<mime>;base64,` prefix from a data URI,
 * returning just the base64 string for writeBinary().
 */
export function dataUriToBase64(dataUri: string): string {
  const comma = dataUri.indexOf(',')
  return comma >= 0 ? dataUri.slice(comma + 1) : dataUri
}
