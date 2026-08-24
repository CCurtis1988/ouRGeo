import type { LayerSymbology, PointShape } from '@/store/spatial'

const SIZE = 64

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: PointShape,
  cx: number,
  cy: number,
  r: number
): void {
  ctx.beginPath()
  switch (shape) {
    case 'square':
      ctx.rect(cx - r, cy - r, r * 2, r * 2)
      break
    case 'triangle':
      ctx.moveTo(cx, cy - r)
      ctx.lineTo(cx + r, cy + r)
      ctx.lineTo(cx - r, cy + r)
      ctx.closePath()
      break
    case 'cross': {
      const t = r * 0.35
      ctx.moveTo(cx - t, cy - r)
      ctx.lineTo(cx + t, cy - r)
      ctx.lineTo(cx + t, cy - t)
      ctx.lineTo(cx + r, cy - t)
      ctx.lineTo(cx + r, cy + t)
      ctx.lineTo(cx + t, cy + t)
      ctx.lineTo(cx + t, cy + r)
      ctx.lineTo(cx - t, cy + r)
      ctx.lineTo(cx - t, cy + t)
      ctx.lineTo(cx - r, cy + t)
      ctx.lineTo(cx - r, cy - t)
      ctx.lineTo(cx - t, cy - t)
      ctx.closePath()
      break
    }
    case 'diamond':
      ctx.moveTo(cx, cy - r)
      ctx.lineTo(cx + r, cy)
      ctx.lineTo(cx, cy + r)
      ctx.lineTo(cx - r, cy)
      ctx.closePath()
      break
    default:
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
  }
}

export function generatePointIcon(sym: LayerSymbology): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!

  const cx = SIZE / 2
  const cy = SIZE / 2
  // Scale radius to leave room for border stroke; pointSize maps 1-20 → r 8-28
  const r = 8 + (sym.pointSize / 20) * 20

  ctx.clearRect(0, 0, SIZE, SIZE)

  // Fill
  ctx.fillStyle = sym.fillColor
  drawShape(ctx, sym.pointShape, cx, cy, r)
  ctx.fill()

  // Border
  if (sym.borderWidth > 0) {
    ctx.strokeStyle = sym.borderColor
    ctx.lineWidth = Math.max(1, sym.borderWidth * 2)
    drawShape(ctx, sym.pointShape, cx, cy, r)
    ctx.stroke()
  }

  return ctx.getImageData(0, 0, SIZE, SIZE)
}
