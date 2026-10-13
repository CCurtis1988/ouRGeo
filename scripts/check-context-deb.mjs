// Run the actual Debian package manager and installed binary in a private
// Debian filesystem. The host packages and regular user profile are untouched.
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir, realpath, symlink, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

if (process.platform !== 'linux') throw new Error('Debian installation acceptance runs on Linux.')
const root = resolve('.'), { version } = JSON.parse(await readFile('package.json', 'utf8'))
const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const filesystem = await realpath(resolve(option('--rootfs', '.cache/stage02/debian/rootfs-minimal')))
assert(filesystem.startsWith(join(await realpath(join(root, '.cache')), 'stage02/debian/')), 'Use a disposable Debian filesystem inside the acceptance cache.')
assert.match(await readFile(join(filesystem, 'etc/os-release'), 'utf8'), /^ID=debian$/m)
const directory = await mkdtemp(join(root, '.cache/context-deb-'))
const artifact = join(root, 'dist', `ouRGeo-${version}.deb`), previous = join(root, 'dist', 'ouRGeo-1.16.15.deb')
const run = (program, argv, log, env = process.env) => new Promise((resolveRun, reject) => {
  const child = spawn(program, argv, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
  child.on('error', reject)
  child.on('close', async code => { if (log) await writeFile(join(directory, log), output); resolveRun({ code, output }) })
})
const namespace = ['--unshare-user', '--uid', '0', '--gid', '0', '--bind', filesystem, '/', '--proc', '/proc', '--dev', '/dev', '--ro-bind', join(root, 'dist'), '/artifacts', '--setenv', 'PATH', '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', '--']
const guest = async (argv, log) => {
  const result = await run('bwrap', [...namespace, ...argv], log)
  assert.equal(result.code, 0, result.output.slice(-4000)); return result.output
}
await guest(['dpkg', '-i', `/artifacts/${previous.split('/').at(-1)}`], 'install.log')
assert.equal((await guest(['dpkg-query', '-W', '-f=${Status} ${Version}\n', 'ourgeo'], 'installed-status.log')).trim(), 'install ok installed 1.16.15')
await guest(['dpkg', '-i', `/artifacts/${artifact.split('/').at(-1)}`], 'upgrade.log')
assert.equal((await guest(['dpkg-query', '-W', '-f=${Status} ${Version}\n', 'ourgeo'], 'upgraded-status.log')).trim(), `install ok installed ${version}`)
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const installedArchive = join(filesystem, 'opt/ouRGeo/resources/app.asar')
const archiveSha256 = await hash(installedArchive)
assert.equal(archiveSha256, await hash(join(root, 'dist/linux-unpacked/resources/app.asar')))
const libraries = await guest(['ldd', '/opt/ouRGeo/ourgeo'], 'runtime-libraries.log')
assert(!libraries.includes('not found'), 'Installed Electron runtime has missing libraries.')
await access(join(filesystem, 'usr/share/applications/ourgeo.desktop'))
assert.equal((await guest(['readlink', '-f', '/usr/bin/ourgeo'], 'installed-command.log')).trim(), '/opt/ouRGeo/ourgeo')

// Map the actual desktop UID for DBus authentication. Only the workspace and
// desktop sockets are visible; the surrounding host home is not mounted.
const launchDirectory = join(directory, 'launch')
await mkdir(launchDirectory)
await symlink(join(filesystem, 'opt/ouRGeo/resources'), join(launchDirectory, 'resources'))
const launchArgs = ['--unshare-user', '--uid', String(process.getuid()), '--gid', String(process.getgid()), '--bind', filesystem, '/', '--proc', '/proc', '--dev', '/dev', '--bind', root, root, '--ro-bind', '/run/user/' + process.getuid(), '/run/user/' + process.getuid(), '--ro-bind', '/tmp/.X11-unix', '/tmp/.X11-unix', '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin', '--', '/opt/ouRGeo/ourgeo', '--ozone-platform=x11']
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'"
const launcher = join(launchDirectory, 'ourgeo')
await writeFile(launcher, '#!/bin/sh\nexec bwrap ' + launchArgs.map(quote).join(' ') + ' "$@"\n', { mode: 0o700 })
const acceptanceTmp = join(root, '.cache/stage02/tmp')
await mkdir(acceptanceTmp, { recursive: true })
const acceptance = await run(process.execPath, ['scripts/check-context.mjs', '--stages-0-2', '--packaged', launcher], 'acceptance.log', { ...process.env, TMPDIR: acceptanceTmp, DEBUG: 'pw:browser' })
assert.equal(acceptance.code, 0, 'Installed Debian acceptance failed; inspect acceptance.log. Package and profile retained.')
const fixture = acceptance.output.split('\n').flatMap(line => { try { const value = JSON.parse(line); return value.packaged === true ? [value] : [] } catch { return [] } }).at(-1)
assert.equal(fixture?.appVersion, version)
assert.equal(fixture?.appPath, '/opt/ouRGeo/resources/app.asar')
assert(fixture.electronSqliteWorker.encryptedStorage)
const actualProfileArchive = join(fixture.profile, 'ourgeo/context/canonical.sqlite')
const profileSha256 = await hash(actualProfileArchive)
const preservedProfile = join(filesystem, 'home/context-acceptance/profile')
await mkdir(preservedProfile, { recursive: true })
await writeFile(join(preservedProfile, 'preserve.txt'), 'Synthetic profile remains after package removal.\n')
await guest(['dpkg', '--remove', 'ourgeo'], 'remove.log')
assert.equal(await hash(actualProfileArchive), profileSha256, 'Removing the package must preserve the actual protected acceptance profile.')
assert.equal(await readFile(join(preservedProfile, 'preserve.txt'), 'utf8'), 'Synthetic profile remains after package removal.\n')
await assert.rejects(access(installedArchive))
await assert.rejects(access(join(filesystem, 'usr/bin/ourgeo')))
await assert.rejects(access(join(filesystem, 'usr/share/applications/ourgeo.desktop')))
const report = { version: 1, appVersion: version, measuredAt: new Date().toISOString(), directory, filesystem, artifactSha256: await hash(artifact), previousArtifactSha256: await hash(previous), archiveSha256, installVersion: '1.16.15', upgradeVersion: version, packageManagerInstallAndUpgrade: true, installedPayloadMatchesUnpacked: true, installedBinaryAcceptance: fixture, packageRemovalVerified: true, profilePreservedOnRemoval: true, passed: true, scope: 'Actual dpkg install, upgrade, installed Debian binary/protected-memory acceptance and removal in a disposable Debian filesystem on the host Linux kernel. Host X11 and keyring services supply the desktop session; this is not a separately booted Debian desktop, association or strict-offline certificate.' }
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
await writeFile('/tmp/ourgeo-context-deb-evidence.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
