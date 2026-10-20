/** Only raster formats with bounded dimensions enter Chromium. An extension
 * alone would also accept an SVG or HTML document renamed to look like a photo. */
export interface RasterInfo { mime: string; width: number; height: number; animated: boolean }
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 24_000_000

function animatedPng(bytes: Buffer): boolean {
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8)
    if (type === 'acTL' && length === 8) return true
    if (type === 'IDAT') return false
    // A large colour profile can put acTL beyond our bounded header read.
    // Treat an unclassified PNG as potentially animated so reduced motion
    // always uses a decoded first frame rather than accidentally playing it.
    if (length > bytes.length - offset - 12) return true
    offset += length + 12
  }
  return true
}

export function inspectRaster(bytes: Buffer): RasterInfo | undefined {
  let info: RasterInfo | undefined
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    info = { mime: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), animated: animatedPng(bytes) }
  } else if (bytes.length >= 13 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) {
    info = { mime: 'image/gif', width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8), animated: true }
  } else if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const type = bytes.toString('ascii', 12, 16)
    if (type === 'VP8X') info = { mime: 'image/webp', width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1, animated: Boolean(bytes[20] & 2) }
    if (type === 'VP8 ' && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 1, 0x2a]))) info = { mime: 'image/webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff, animated: false }
    if (type === 'VP8L' && bytes[20] === 0x2f) info = { mime: 'image/webp', width: 1 + (bytes.readUInt32LE(21) & 0x3fff), height: 1 + ((bytes.readUInt32LE(21) >>> 14) & 0x3fff), animated: false }
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xd9 || marker === 0xda) break
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
      if (offset + 2 > bytes.length) break
      const length = bytes.readUInt16BE(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        info = { mime: 'image/jpeg', width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3), animated: false }
        break
      }
      offset += length
    }
  }
  return info && info.width > 0 && info.height > 0 && info.width <= 16_384 && info.height <= 16_384 && info.width * info.height <= MAX_IMAGE_PIXELS ? info : undefined
}

export function matchingImageExtension(path: string, mime: string): boolean {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  return ({ 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'], 'image/gif': ['.gif'] } as Record<string, string[]>)[mime]?.includes(ext) ?? false
}
