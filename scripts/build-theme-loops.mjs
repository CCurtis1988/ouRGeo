#!/usr/bin/env node
// Local, deterministic GIF encoding from the existing painted backgrounds.
// Local feathered reflection/cloud/glow motion leaves the rest of the painting
// fixed. Authoring gates account for small previews and cropped, faint editors.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const gallery = resolve(root, 'src/assets/themes/gallery')
const evidence = resolve(root, '.cache/theme-artwork')
const FRAMES = 80, FPS = 10, WIDTH = 960, HEIGHT = 540
const regions = {
  dark: [{ x: 300, y: 330, w: 500, h: 190, kind: 'water', amplitude: 8, subject: 'central moonlight reflection on the lake' }],
  bespin: [{ x: 260, y: 290, w: 540, h: 240, kind: 'water', amplitude: 8, subject: 'central sunset cloud bank' }],
  neonLights: [{ x: 260, y: 400, w: 500, h: 130, kind: 'water', amplitude: 8, subject: 'central neon reflections on wet asphalt' }],
  forest: [{ x: 210, y: 75, w: 620, h: 405, kind: 'daylight', amplitude: 10, subject: 'warm daylight through the central trees' }, { x: 530, y: 405, w: 340, h: 125, kind: 'water', amplitude: 8, subject: 'stream reflections' }],
  midnightDream: [{ x: 260, y: 320, w: 540, h: 200, kind: 'water', amplitude: 8, subject: 'central starlight reflections on the lake' }],
  candyAddiction: [{ x: 280, y: 390, w: 500, h: 140, kind: 'water', amplitude: 8, subject: 'central pink river reflections' }],
  heaven: [{ x: 250, y: 320, w: 500, h: 210, kind: 'water', amplitude: 12, subject: 'central lower cloud bank' }],
  volcanic: [{ x: 200, y: 330, w: 520, h: 190, kind: 'water', amplitude: 8, subject: 'central foreground lava reflections' }],
  arctic: [{ x: 235, y: 0, w: 530, h: 242, kind: 'aurora', amplitude: 0.16, subject: 'aurora light intensity with stationary stars' }, { x: 210, y: 328, w: 580, h: 194, kind: 'water', amplitude: 8, subject: 'central fjord reflections' }],
  retroTerminal: [{ x: 180, y: 235, w: 650, h: 295, kind: 'terminal', amplitude: 18, subject: 'green ambient light over the central floor and terminal room' }],
}
const BACKGROUNDS = { dark: [15, 17, 23], bespin: [35, 26, 16], neonLights: [13, 13, 13], forest: [11, 26, 13], midnightDream: [6, 6, 25], candyAddiction: [24, 9, 31], heaven: [240, 248, 255], volcanic: [19, 10, 5], arctic: [11, 21, 32], retroTerminal: [3, 15, 3] }
const STAGING = process.argv.includes('--staging')
const PUBLISH_STAGED = process.argv.includes('--publish-staged')
if (STAGING && PUBLISH_STAGED) throw new Error('Choose --staging or --publish-staged, not both.')
const staged = resolve(root, '.cache/theme-gif-motion/staged')

async function run(command, args, { capture = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, MAGICK_THREAD_LIMIT: '2' }, stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'] })
    const output = [], errors = []
    child.stdout?.on('data', data => output.push(data))
    child.stderr.on('data', data => errors.push(data))
    const timer = setTimeout(() => child.kill('SIGTERM'), 180_000)
    child.once('error', reject)
    child.once('close', code => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`${command} exited ${code}: ${Buffer.concat(errors).toString().slice(-4000)}`))
      else resolveRun(Buffer.concat(output))
    })
  })
}

function smooth(q) { return `pow(${q},2)*(3-2*${q})` }
function feather(w, h) {
  return `${smooth(`min(1,max(0,min(X/70,(${w}-1-X)/70)))`)}*${smooth(`min(1,max(0,min(Y/32,(${h}-1-Y)/32)))`)}`
}

function filter(plan) {
  const phase = `2*PI*mod(N,${FRAMES - 1})/${FRAMES - 1}`
  // A stationary centre needs appreciable motion after preview downscaling,
  // cover cropping and the editor's 18% opacity. The previous 1.6 px, tightly
  // feathered ripple passed hash tests while looking like a still image.
  let text = `[0:v]fps=${FPS},scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},trim=end_frame=${FRAMES},format=gbrp[stage0];`
  for (const [index, region] of plan.entries()) {
    const mask = feather(region.w, region.h), wave = `sin(${phase})`
    const dx = `${region.amplitude}*${wave}*sin(Y/24+${phase})*${mask}`
    const channels = ['r', 'g', 'b'].map(channel => {
      // geq wraps out-of-range values instead of clipping them. Without clip,
      // a bright highlight can become black during an otherwise gentle glow.
      if (region.kind === 'terminal') return `${channel}='clip(${channel}(X,Y)+${channel === 'g' ? region.amplitude : 5}*${wave}*${mask},0,255)'`
      if (region.kind === 'daylight') return `${channel}='clip(${channel}(X,Y)+${channel === 'r' ? region.amplitude : channel === 'g' ? region.amplitude * .9 : region.amplitude * .4}*${wave}*${mask},0,255)'`
      if (region.kind === 'aurora') return `${channel}='clip(${channel}(X,Y)*(1+${region.amplitude}*${wave}*${mask}*min(1,max(0,(g(X,Y)-r(X,Y)-8)/65))),0,255)'`
      return `${channel}='${channel}(X+${dx},Y)'`
    }).join(':')
    text += `[stage${index}]split[base${index}][patch${index}];[patch${index}]crop=${region.w}:${region.h}:${region.x}:${region.y},geq=${channels}[move${index}];[base${index}][move${index}]overlay=${region.x}:${region.y}:format=rgb:shortest=1[stage${index + 1}];`
  }
  return `${text}[stage${plan.length}]split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle[out]`
}

function themeFilter(id, pixel, legacy) {
  if (legacy) { const grey = .2126 * pixel[0] + .7152 * pixel[1] + .0722 * pixel[2]; return [grey, grey, grey] }
  if (id !== 'heaven') return pixel
  const contrast = pixel.map(value => (value - 127.5) * .9 + 127.5)
  const luma = .2126 * contrast[0] + .7152 * contrast[1] + .0722 * contrast[2]
  return contrast.map(value => .9 * value + .1 * luma)
}

async function visibleMotion(id, path) {
  const result = {}
  const opacity = id === 'heaven' ? .30 : .18
  for (const [view, resize, width, height, alpha, legacy] of [
    ['galleryPreview', ',scale=208:117', 208, 117, 1, false],
    ['editorWide', '', 960, 540, opacity, false],
    ['editorPortrait', ',crop=432:540:264:0', 432, 540, opacity, false],
    ['legacyPortrait', ',crop=432:540:264:0', 432, 540, .15, true],
  ]) {
    const bytes = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-threads', '2', '-i', path, '-vf', `select='eq(n,0)+eq(n,20)'${resize}`, '-fps_mode', 'passthrough', '-frames:v', '2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { capture: true })
    const frame = width * height * 3, bg = BACKGROUNDS[id]
    if (bytes.length !== frame * 2) throw new Error(`Unexpected ${view} frame size for ${id}`)
    let squares = 0, changed = 0, twoLevels = 0, threeLevels = 0
    for (let offset = 0; offset < frame; offset += 3) {
      const beforeRaw = [...bytes.subarray(offset, offset + 3)], afterRaw = [...bytes.subarray(frame + offset, frame + offset + 3)]
      const before = view === 'galleryPreview' ? beforeRaw : themeFilter(id, beforeRaw, legacy)
      const after = view === 'galleryPreview' ? afterRaw : themeFilter(id, afterRaw, legacy)
      let maximum = 0
      for (let channel = 0; channel < 3; channel++) {
        const delta = Math.abs(Math.round(before[channel] * alpha + bg[channel] * (1 - alpha)) - Math.round(after[channel] * alpha + bg[channel] * (1 - alpha)))
        maximum = Math.max(maximum, delta); squares += delta * delta
      }
      if (maximum) changed++
      if (maximum >= 2) twoLevels++
      if (maximum >= 3) threeLevels++
    }
    result[view] = { width, height, opacity: alpha, grayscale: legacy, rms: Math.sqrt(squares / frame), changedFraction: changed / (width * height), atLeastTwoChannelLevelsFraction: twoLevels / (width * height), atLeastThreeChannelLevelsFraction: threeLevels / (width * height) }
  }
  return result
}

function assertVisibleMotion(id, metrics) {
  // These are authoring gates, not universal perceptual guarantees: native
  // compositor review remains necessary. In particular, frame hashes alone
  // say nothing about what survives a small preview or a narrow editor.
  const gates = { galleryPreview: { rms: 1.5, fraction: .02 }, editorWide: { rms: .65, fraction: .01 }, editorPortrait: { rms: .65, fraction: .01 }, legacyPortrait: { rms: .35, fraction: .005 } }
  for (const [view, gate] of Object.entries(gates)) {
    const actual = metrics[view]
    if (actual.rms < gate.rms || actual.atLeastTwoChannelLevelsFraction < gate.fraction) throw new Error(`${id} looks too still in ${view}: RMS ${actual.rms.toFixed(3)} (minimum ${gate.rms}), ${(actual.atLeastTwoChannelLevelsFraction * 100).toFixed(2)}% changing by ≥2 levels (minimum ${gate.fraction * 100}%). Strengthen or reposition its motion; the previous published GIF has been kept.`)
  }
}

function foreverLoop(bytes) {
  const marker = bytes.indexOf(Buffer.from('NETSCAPE2.0'))
  return marker >= 0 && bytes[marker + 11] === 3 && bytes[marker + 12] === 1 && bytes.readUInt16LE(marker + 13) === 0
}

await mkdir(gallery, { recursive: true })
await mkdir(evidence, { recursive: true })
await mkdir(staged, { recursive: true })
const themeArg = process.argv.indexOf('--theme')
const selected = themeArg >= 0 ? (process.argv[themeArg + 1] || '').split(',') : Object.keys(regions)
if (selected.some(id => !regions[id])) throw new Error(`Choose one of: ${Object.keys(regions).join(', ')}`)
const reportPath = resolve(STAGING ? staged : evidence, 'loops.json')
let report = {}
try { report = JSON.parse(await readFile(reportPath, 'utf8')) } catch { /* A fresh artwork build has no previous evidence. */ }
for (const themeId of selected) {
  const input = resolve(root, `src/assets/themes/${themeId}.webp`), output = resolve(STAGING ? staged : gallery, `${themeId}-loop.gif`)
  // Encode beside the evidence first. Vite may be watching the gallery while
  // the user works; replacing a verified file atomically avoids serving a
  // partially written GIF and keeps the previous asset on every failure.
  const temporary = resolve(staged, `${themeId}-encoding.gif`)
  if (PUBLISH_STAGED) {
    const stagedReport = JSON.parse(await readFile(resolve(staged, 'loops.json'), 'utf8'))[themeId]
    const stagedFile = resolve(staged, `${themeId}-loop.gif`)
    const stagedBytes = await readFile(stagedFile)
    if (!stagedReport || JSON.stringify(stagedReport.regions) !== JSON.stringify(regions[themeId]) || stagedReport.sha256 !== createHash('sha256').update(stagedBytes).digest('hex')) throw new Error(`${themeId} staged artwork or its parameters have changed. Run --staging and review it before publishing.`)
    await copyFile(stagedFile, temporary)
  } else await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-threads', '2', '-loop', '1', '-i', input, '-filter_complex_threads', '1', '-filter_complex', filter(regions[themeId]), '-map', '[out]', '-frames:v', String(FRAMES), '-loop', '0', '-y', temporary])
  const poster = resolve(gallery, `${themeId}-loop-poster.webp`), thumb = resolve(gallery, `${themeId}-loop-thumb.webp`)
  // All phase-zero frames retain the existing composition. Leave established
  // high-resolution posters alone rather than changing unrelated assets.
  if (!STAGING) {
    try { await stat(poster) } catch { await run('magick', [input, '-resize', '1600x900^', '-gravity', 'center', '-extent', '1600x900', '-quality', '86', poster]) }
    try { await stat(thumb) } catch { await run('magick', [input, '-resize', '320x180^', '-gravity', 'center', '-extent', '320x180', '-quality', '82', thumb]) }
  }
  const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', temporary], { capture: true })).toString())
  const hashes = (await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-threads', '2', '-i', temporary, '-pix_fmt', 'rgb24', '-f', 'framemd5', '-'], { capture: true })).toString().split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim())
  const bytes = await readFile(temporary), stream = probe.streams[0]
  const motion = await visibleMotion(themeId, temporary)
  report[themeId] = { input: `src/assets/themes/${themeId}.webp`, inputSha256: createHash('sha256').update(await readFile(input)).digest('hex'), output: output.slice(root.length), animation: `Peaceful cyclic ${regions[themeId].map(region => region.subject).join(' and ')}; encoded from the existing still, not generative video.`, width: stream.width, height: stream.height, frames: hashes.length, uniqueFrames: new Set(hashes).size, fps: FPS, durationSeconds: Number(probe.format.duration), bytes: bytes.length, loopsForever: foreverLoop(bytes), firstFrameMd5: hashes[0], lastFrameMd5: hashes.at(-1), firstLastIdentical: hashes[0] === hashes.at(-1), firstLastPixelDifference: hashes[0] === hashes.at(-1) ? 0 : null, sha256: createHash('sha256').update(bytes).digest('hex'), regions: regions[themeId], visibleMotion: motion, metricsVersion: 'visible-motion-v2' }
  if (stream.width !== WIDTH || stream.height !== HEIGHT || Math.abs(Number(probe.format.duration) - FRAMES / FPS) > .01 || report[themeId].uniqueFrames < FRAMES / 2 || !report[themeId].firstLastIdentical || !report[themeId].loopsForever || hashes.length !== FRAMES) throw new Error(`Loop verification failed for ${themeId}: ${JSON.stringify(report[themeId])}`)
  if (bytes.length > 5 * 1024 ** 2) throw new Error(`${themeId} exceeds the 5 MiB GIF budget. Reduce its moving area; the previous published GIF has been kept.`)
  assertVisibleMotion(themeId, motion)
  await rename(temporary, output)
  await writeFile(reportPath, JSON.stringify(report, null, 2))
  console.log(`${themeId}: ${(bytes.length / 1024 ** 2).toFixed(2)} MiB, ${hashes.length} frames, seamless endpoints, visible preview/editor/portrait motion`)
}
