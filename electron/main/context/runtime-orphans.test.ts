import { expect, it } from 'vitest'
import { ownedRuntimeProcess } from './runtime-orphans'

const root = '/private/ourgeo/memory-runtimes', cwd = `${root}/installed_12345678-1234-1234-1234-123456789abc`
const executable = `${cwd}/.runtime-unpack-python/python/bin/python3.12`
const argv = [executable, '-I', '-B', '-S', `${cwd}/ourgeo-bridge.py`, `${cwd}/.runtime-unpack-engine/mnemosyne-${'a'.repeat(40)}`, `${cwd}/.runtime-unpack-yaml/pyyaml-6.0.3/lib`, `${cwd}/derived`, '--parent-pid', '1234']
it('recognises exact current and pre-supervision private runtime layouts', () => {
  expect(ownedRuntimeProcess(root, executable, cwd, argv, 1000, 1000)).toBe(true)
  expect(ownedRuntimeProcess(root, executable, cwd, argv.filter(value => value !== '-B').slice(0, -2), 1000, 1000)).toBe(true)
})
it('never selects another user, unrelated interpreter, foreign directory or provider arguments', () => {
  expect(ownedRuntimeProcess(root, executable, cwd, argv, 1001, 1000)).toBe(false)
  expect(ownedRuntimeProcess(root, '/usr/bin/python3.12', cwd, argv, 1000, 1000)).toBe(false)
  expect(ownedRuntimeProcess(root, executable, '/another/application', argv, 1000, 1000)).toBe(false)
  for (const index of [0, 4, 5, 6, 7]) {
    const changed = [...argv]; changed[index] = '/another/application/private-file'
    expect(ownedRuntimeProcess(root, executable, cwd, changed, 1000, 1000)).toBe(false)
  }
  expect(ownedRuntimeProcess(root, executable, cwd, [...argv, '--unreviewed-command'], 1000, 1000)).toBe(false)
})
