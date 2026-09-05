import { describe, it, expect } from 'vitest'
import {
  availableShells, resolveShell, shellFamily, shellCandidates,
} from './shells'

/** An `exists` predicate over a fixed set of installed paths. */
const installed = (...paths: string[]) => (p: string): boolean => paths.includes(p)

describe('the shell a terminal opens on Unix', () => {
  it('offers the user their own $SHELL first, under its own name', () => {
    const shells = availableShells(
      'linux',
      { SHELL: '/usr/bin/fish' },
      installed('/usr/bin/fish', '/bin/bash'),
    )
    expect(shells[0]).toMatchObject({ id: 'fish', label: 'Fish', path: '/usr/bin/fish' })
    expect(shells.map((s) => s.id)).toContain('bash')
  })

  it('finds $SHELL where it actually is, not only in the usual directories', () => {
    // A nix profile, ~/.local/bin, a Homebrew prefix — the point of reading
    // $SHELL is that we do not have to know where the user keeps it.
    const shells = availableShells(
      'linux',
      { SHELL: '/home/me/.nix-profile/bin/zsh' },
      installed('/home/me/.nix-profile/bin/zsh'),
    )
    expect(shells).toHaveLength(1)
    expect(shells[0].path).toBe('/home/me/.nix-profile/bin/zsh')
  })

  it('does not list the same shell twice when $SHELL is one we know', () => {
    const shells = availableShells(
      'linux',
      { SHELL: '/bin/bash' },
      installed('/bin/bash'),
    )
    expect(shells.filter((s) => s.id === 'bash')).toHaveLength(1)
  })

  it('falls back to whatever is installed when $SHELL is unset', () => {
    const shells = availableShells('linux', {}, installed('/usr/bin/zsh'))
    expect(shells.map((s) => s.id)).toEqual(['zsh'])
  })

  it('drops shells that are not installed rather than offering them', () => {
    // A profile menu listing shells that fail at spawn time is worse than a
    // short menu: the failure arrives after the user has committed to a choice.
    const shells = availableShells('linux', {}, installed('/bin/sh'))
    expect(shells.map((s) => s.id)).toEqual(['sh'])
  })
})

describe('login shells', () => {
  it('launches a login shell on macOS, because the GUI PATH is missing Homebrew', () => {
    const shells = availableShells('darwin', { SHELL: '/bin/zsh' }, installed('/bin/zsh'))
    expect(shells[0].args).toEqual(['-l'])
  })

  it('does not on Linux, where the desktop session already has the environment', () => {
    const shells = availableShells('linux', { SHELL: '/bin/zsh' }, installed('/bin/zsh'))
    expect(shells[0].args).toEqual([])
  })
})

describe('the shell a terminal opens on Windows', () => {
  const env = {
    ProgramFiles: 'C:\\Program Files',
    SystemRoot: 'C:\\Windows',
    COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
  }

  it('prefers PowerShell 7 when it is installed', () => {
    const shells = availableShells('win32', env, installed(
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\System32\\cmd.exe',
    ))
    expect(shells.map((s) => s.id)).toEqual(['pwsh', 'powershell', 'cmd'])
  })

  it('falls back through Windows PowerShell to cmd', () => {
    const shells = availableShells('win32', env, installed('C:\\Windows\\System32\\cmd.exe'))
    expect(shells.map((s) => s.id)).toEqual(['cmd'])
  })

  it('offers Git Bash and WSL when they are there', () => {
    const shells = availableShells('win32', env, installed(
      'C:\\Windows\\System32\\cmd.exe',
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Windows\\System32\\wsl.exe',
    ))
    expect(shells.map((s) => s.id)).toEqual(['cmd', 'git-bash', 'wsl'])
    // What Git for Windows' own terminal passes: --login sets up MSYS, -i makes
    // it interactive. Without them the shell starts in a half-configured state.
    expect(shells.find((s) => s.id === 'git-bash')?.args).toEqual(['--login', '-i'])
  })

  it('never proposes a path built from an environment variable that is unset', () => {
    // `expand` leaves an unset %VAR% empty, so the template collapses to a bare
    // `\Program Files\...` — a path that is not absolute on Windows and would
    // resolve against whatever the current drive happens to be.
    const paths = shellCandidates('win32', {}).flatMap((c) => c.paths)
    expect(paths.every((p) => !p.startsWith('\\'))).toBe(true)
  })
})

describe('choosing between them', () => {
  const shells = availableShells('linux', {}, installed('/bin/bash', '/usr/bin/zsh'))

  it('honours the profile the user picked', () => {
    expect(resolveShell(shells, 'zsh')?.id).toBe('zsh')
  })

  it('falls back to the best available when their choice is gone', () => {
    // A shell can be uninstalled between sessions, and the preference file
    // outlives it. Falling back beats refusing to open a terminal.
    expect(resolveShell(shells, 'fish')?.id).toBe('bash')
  })

  it('reports nothing rather than guessing when no shell was found', () => {
    expect(resolveShell([], 'bash')).toBeNull()
  })
})

describe('which syntax a shell speaks', () => {
  // Only `terminal:run`'s exit-code marker needs this, and it has to be
  // conservative: guessing POSIX for an unknown shell puts `$?` into the user's
  // prompt as literal text.
  it.each([
    ['/bin/bash', 'posix'],
    ['/usr/bin/zsh', 'posix'],
    ['/bin/sh', 'posix'],
    ['/usr/bin/fish', 'fish'],
    ['C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'powershell'],
    ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'powershell'],
    ['C:\\Windows\\System32\\cmd.exe', 'cmd'],
  ])('reads %s as %s', (path, family) => {
    expect(shellFamily({ id: 'x', path })).toBe(family)
  })

  it('says it does not know rather than assuming', () => {
    expect(shellFamily({ id: 'x', path: '/usr/bin/nushell' })).toBe('unknown')
  })

  it('treats WSL as POSIX, since wsl.exe launches the distro default shell', () => {
    expect(shellFamily({ id: 'wsl', path: 'C:\\Windows\\System32\\wsl.exe' })).toBe('posix')
  })
})
