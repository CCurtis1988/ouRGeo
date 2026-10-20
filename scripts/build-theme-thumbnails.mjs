#!/usr/bin/env node
// Small static thumbnails keep the picker from decoding every full painting.
// Existing artwork stays untouched; ImageMagick only produces packaged siblings.
import { spawn } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const gallery = resolve(root, 'src/assets/themes/gallery')
const manifest = JSON.parse(await readFile(resolve(gallery, 'prompts.json'), 'utf8'))
const field = JSON.parse(await readFile(resolve(gallery, 'field-prompts.json'), 'utf8'))
const themes = [...new Set([...manifest.images, ...field.images].map(image => image.theme))]
const images = [
  ...themes.map(theme => ({ input: resolve(root, `src/assets/themes/${theme}.webp`), output: resolve(gallery, `${theme}-default-thumb.webp`) })),
  ...(await readdir(gallery)).filter(name => /-\d+\.webp$/.test(name)).map(name => ({ input: resolve(gallery, name), output: resolve(gallery, name.replace('.webp', '-thumb.webp')) })),
]
let count = 0
for (const { input, output } of images) {
  const source = await stat(input)
  try { if ((await stat(output)).mtimeMs >= source.mtimeMs) continue } catch { /* New artwork needs its first thumbnail. */ }
  await new Promise((done, reject) => {
    const child = spawn('magick', [input, '-resize', '320x180^', '-gravity', 'center', '-extent', '320x180', '-quality', '80', output], { cwd: root, env: { ...process.env, MAGICK_THREAD_LIMIT: '2' }, stdio: ['ignore', 'ignore', 'pipe'] })
    const errors = []
    child.stderr.on('data', data => errors.push(data))
    child.on('error', reject)
    child.on('exit', code => code === 0 ? done() : reject(new Error(`Thumbnail failed for ${input}: ${Buffer.concat(errors).toString()}`)))
  })
  count++
}
console.log(`Built ${count} thumbnails; ${images.length} paintings available.`)
