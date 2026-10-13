// Exercise a disposable portable Linux installation from the actual AppImage.
// Extraction and native FUSE launch are separately recorded. The regular
// profile and desktop menu are untouched; Debian installation is separate.
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, copyFile, chmod, readFile, writeFile, rm, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
if (process.platform !== 'linux') throw new Error('Portable installation acceptance runs on Linux.')
const nativeFuse = process.argv.includes('--native-fuse')
if (nativeFuse && process.env.APPIMAGE_EXTRACT_AND_RUN) throw new Error('Unset APPIMAGE_EXTRACT_AND_RUN before testing actual FUSE mounting.')
const root = resolve('.'), { version } = JSON.parse(await readFile('package.json', 'utf8'))
const cache = join(root, '.cache')
await mkdir(cache, { recursive: true })
const directory = await mkdtemp(join(cache, 'context-install-'))
const installation = join(directory, 'installation')
await mkdir(installation)
const artifact = join(root, 'dist', `ouRGeo-${version}.AppImage`), installed = join(installation, 'ouRGeo.AppImage')
await copyFile(artifact, installed); await chmod(installed, 0o700)
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const artifactSha256 = await hash(artifact)
assert.equal(await hash(installed), artifactSha256)
const run = (command, args, cwd, log) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  child.on('error', reject)
  child.on('close', async code => { await writeFile(log, output); resolve({ code, output }) })
})
const extraction = await run(installed, ['--appimage-extract'], installation, join(directory, 'extraction.log'))
assert.equal(extraction.code, 0, 'Portable AppImage extraction failed; inspect extraction.log.')
const payload = join(installation, 'squashfs-root'), executable = join(payload, 'ourgeo'), archive = join(payload, 'resources/app.asar')
assert.equal(await hash(executable), await hash(join(root, 'dist/linux-unpacked/ourgeo')))
assert.equal(await hash(archive), await hash(join(root, 'dist/linux-unpacked/resources/app.asar')))
const archiveSha256 = await hash(archive)
const acceptance = await run(process.execPath, ['scripts/check-context.mjs', '--stages-0-2', '--packaged', nativeFuse ? installed : executable], root, join(directory, 'acceptance.log'))
const fixture = acceptance.output.split('\n').flatMap(line => { try { const value = JSON.parse(line); return value?.packaged === true ? [value] : [] } catch { return [] } }).at(-1)
assert.equal(acceptance.code, 0, 'Installed payload acceptance failed; inspect acceptance.log. Installation retained.')
assert(fixture?.packaged && fixture.electronSqliteWorker.encryptedStorage)
assert.equal(fixture.appVersion, version)
if (nativeFuse) assert.equal(fixture.filesystemType, 0x65735546, 'Native launch must run from a FUSE filesystem, not an extracted fallback.')
// Only the installation generated above is removed. Logs, hashes and the
// harness's marked synthetic profile stay available for review.
assert(installation.startsWith(join(cache, 'context-install-')) && installation.endsWith('/installation'))
await rm(installation, { recursive: true })
let removed = false
try { await access(installation) } catch (error) { if (error.code === 'ENOENT') removed = true; else throw error }
assert(removed)
const report = { version: 1, measuredAt: new Date().toISOString(), appVersion: version, platform: `${process.platform}-${process.arch}`,
  directory, artifact, artifactSha256, archiveSha256, extraction: true, installedPayloadMatchesUnpacked: true, nativeFuseMountVerified: nativeFuse,
  acceptanceExitCode: acceptance.code, fixture, uninstallRemovedDisposableInstallation: removed, passed: true,
  scope: `${nativeFuse ? 'Actual FUSE-mounted AppImage launch verified. ' : 'Extraction fallback only; native FUSE mounting not certified. '}Copy, extract, launch and remove a portable AppImage installation under the workspace cache. No native desktop integration, Debian package-manager installation or removal of user data is certified.` }
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
await writeFile(nativeFuse ? '/tmp/ourgeo-context-native-appimage-evidence.json' : '/tmp/ourgeo-context-package-evidence.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
