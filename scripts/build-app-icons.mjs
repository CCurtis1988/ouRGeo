// Render the unchanged website artwork through its circular alpha mask, then
// resize and package it for each OS. White snow/text inside stays opaque.
// Generated files are checked in, so building ouRGeo needs no image tools.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
const build = resolve(root, 'build'), source = resolve(build, 'logo-source.png'), mask = resolve(build, 'logo-mask.png')
await mkdir(resolve(build, 'icons'), { recursive: true })
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
for (const size of sizes) {
  await run('magick', [source, mask, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', '-filter', 'Lanczos', '-resize', `${size}x${size}`, '-strip', '-define', 'png:exclude-chunk=date,time', `PNG32:${resolve(build, 'icons', `${size}x${size}.png`)}`], { env: { ...process.env, MAGICK_THREAD_LIMIT: '2' } })
}
await writeFile(resolve(build, 'icon.png'), await readFile(resolve(build, 'icons/1024x1024.png')))
await writeFile(resolve(root, 'src/assets/app-icon.png'), await readFile(resolve(build, 'icons/32x32.png')))
await run('magick', [...sizes.filter(size => size <= 256).map(size => resolve(build, 'icons', `${size}x${size}.png`)), resolve(build, 'icon.ico')])

// Modern ICNS is a length-prefixed container of PNG representations. Include
// Retina sizes explicitly, without requiring Apple's iconutil on Linux.
const representations = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 }
const chunks = []
for (const [type, size] of Object.entries(representations)) {
  const png = await readFile(resolve(build, 'icons', `${size}x${size}.png`))
  const header = Buffer.alloc(8)
  header.write(type); header.writeUInt32BE(png.length + 8, 4)
  chunks.push(header, png)
}
const body = Buffer.concat(chunks), header = Buffer.alloc(8)
header.write('icns'); header.writeUInt32BE(body.length + 8, 4)
await writeFile(resolve(build, 'icon.icns'), Buffer.concat([header, body]))
console.log('Built ouRGeo PNG, ICO, ICNS and Linux icon sizes from build/logo-source.png.')
