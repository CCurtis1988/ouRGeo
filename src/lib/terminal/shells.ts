// Which shell a terminal opens, and what else the user could pick.
//
// Pure, and imported by `electron/main/terminal.ts` rather than duplicated
// there — the same arrangement `src/lib/markdown/knit-errors.ts` has with
// `knit.ts`, and for the same reason: it lives under `src/` so the renderer's
// Vitest suite covers it (tsconfig.node.json lists it so main can compile
// against it). Nothing here touches the filesystem; the caller injects an
// `exists` predicate, because "is this shell installed" is the one question
// that cannot be answered without a disk and is therefore the one thing worth
// keeping out of the tested part.
//
// ── Login shells, and why only on macOS ────────────────────────────────────
//
// A GUI-launched app on macOS inherits a minimal PATH: launchd does not run
// the user's shell profile, so `/opt/homebrew/bin` and `/usr/local/bin` are
// simply absent. A non-login zsh reads ~/.zshrc but NOT ~/.zprofile, which is
// where Homebrew's shellenv is written — so a terminal opened without `-l`
// cannot find `brew`, and on many machines cannot find R either.
//
// Linux and Windows have no such gap: the desktop session already carries the
// user's environment, and forcing a login shell there would re-run ~/.profile
// on every new tab, which is a surprise rather than a fix.

/** The platforms ouRGeo has an answer for. Anything else falls through to the
 *  Unix branch, which is the right guess for a Unix this list has not met. */
export type TerminalPlatform = 'linux' | 'darwin' | 'win32' | (string & {})

/** A shell the user can open, resolved to something spawnable. */
export interface ShellProfile {
  /** Stable across launches — it is what `terminal-preferences.json` stores and
   *  what `terminal:open` accepts, so it must not be derived from a path. */
  id: string
  /** What the `+` menu and the tab say. */
  label: string
  /** Absolute path to the executable. */
  path: string
  args: string[]
}

/** One shell we know how to look for, before we know whether it is installed. */
interface Candidate {
  id: string
  label: string
  /** Where to look, in order. The first that exists wins. */
  paths: string[]
  args: string[]
}

/** Expand `%NAME%` against the environment, leaving unset ones empty. */
function expand(template: string, env: Record<string, string | undefined>): string {
  return template.replace(/%([^%]+)%/g, (_, name: string) => env[name] ?? '')
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] ?? p
}

/** Title Case for a bare shell name: `zsh` → `Zsh`, `pwsh.exe` → `Pwsh`. */
function prettify(name: string): string {
  const bare = name.replace(/\.exe$/i, '')
  return bare.charAt(0).toUpperCase() + bare.slice(1)
}

const UNIX_DIRS = ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']

function unixCandidate(name: string, label: string, login: boolean): Candidate {
  return {
    id: name,
    label,
    paths: UNIX_DIRS.map((d) => `${d}/${name}`),
    args: login ? ['-l'] : [],
  }
}

/**
 * Every shell worth offering on this platform, best first.
 *
 * `$SHELL` leads on Unix and is deliberately not deduplicated away: it is the
 * shell the user chose for themselves, and offering it under its own name is
 * how a fish user sees "fish" rather than having to know it is their default.
 */
export function shellCandidates(
  platform: TerminalPlatform,
  env: Record<string, string | undefined>,
): Candidate[] {
  if (platform === 'win32') {
    return [
      {
        id: 'pwsh',
        label: 'PowerShell',
        paths: [
          expand('%ProgramFiles%\\PowerShell\\7\\pwsh.exe', env),
          expand('%ProgramW6432%\\PowerShell\\7\\pwsh.exe', env),
          expand('%LOCALAPPDATA%\\Microsoft\\WindowsApps\\pwsh.exe', env),
          'pwsh.exe',
        ].filter((p) => !p.startsWith('\\')),
        // -NoLogo only; -NoProfile would be faster but would silently ignore
        // the user's own profile, which is not ouRGeo's call to make.
        args: ['-NoLogo'],
      },
      {
        id: 'powershell',
        label: 'Windows PowerShell',
        paths: [
          expand('%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', env),
          'powershell.exe',
        ].filter((p) => !p.startsWith('\\')),
        args: ['-NoLogo'],
      },
      {
        id: 'cmd',
        label: 'Command Prompt',
        paths: [
          env.COMSPEC ?? '',
          expand('%SystemRoot%\\System32\\cmd.exe', env),
          'cmd.exe',
        ].filter((p) => p.length > 0 && !p.startsWith('\\')),
        args: [],
      },
      {
        id: 'git-bash',
        label: 'Git Bash',
        paths: [
          expand('%ProgramFiles%\\Git\\bin\\bash.exe', env),
          expand('%ProgramW6432%\\Git\\bin\\bash.exe', env),
          expand('%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe', env),
        ].filter((p) => !p.startsWith('\\')),
        // What Git for Windows' own terminal uses: --login so the MSYS
        // environment is set up, -i so it is interactive.
        args: ['--login', '-i'],
      },
      {
        id: 'wsl',
        label: 'WSL',
        paths: [expand('%SystemRoot%\\System32\\wsl.exe', env)].filter((p) => !p.startsWith('\\')),
        args: [],
      },
    ]
  }

  const login = platform === 'darwin'
  const preferred = env.SHELL?.trim()
  const known: Candidate[] = [
    unixCandidate('bash', 'Bash', login),
    unixCandidate('zsh', 'Zsh', login),
    unixCandidate('fish', 'Fish', login),
    unixCandidate('sh', 'Sh', login),
  ]

  if (!preferred) return known

  // The user's own shell, under its own name and at its own path — which may
  // be somewhere UNIX_DIRS does not list (a nix profile, ~/.local/bin).
  const name = basename(preferred)
  const mine: Candidate = {
    id: name,
    label: prettify(name),
    paths: [preferred, ...UNIX_DIRS.map((d) => `${d}/${name}`)],
    args: login ? ['-l'] : [],
  }
  return [mine, ...known.filter((c) => c.id !== mine.id)]
}

/**
 * The shells actually present, best first — the first is what a new terminal
 * opens with when the user has not chosen.
 *
 * `exists` answers for one absolute path. A candidate with no surviving path is
 * dropped rather than offered and allowed to fail at spawn time, because a
 * profile menu listing shells that are not installed is worse than a short one.
 */
export function availableShells(
  platform: TerminalPlatform,
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean,
): ShellProfile[] {
  const out: ShellProfile[] = []
  const seen = new Set<string>()
  for (const c of shellCandidates(platform, env)) {
    const hit = c.paths.find((p) => exists(p))
    if (!hit || seen.has(c.id)) continue
    seen.add(c.id)
    out.push({ id: c.id, label: c.label, path: hit, args: c.args })
  }
  return out
}

/**
 * The profile to open with: the one the user asked for, else the best present.
 *
 * Returns null only when nothing at all was found, which on any real machine
 * means the `exists` predicate is wrong rather than that the machine has no
 * shell — so the caller reports it as a failure to detect, not as "no shell".
 */
export function resolveShell(
  profiles: ShellProfile[],
  preferredId: string | null | undefined,
): ShellProfile | null {
  if (preferredId) {
    const hit = profiles.find((p) => p.id === preferredId)
    if (hit) return hit
  }
  return profiles[0] ?? null
}

/**
 * Which family a shell belongs to, for anything that has to write shell syntax.
 *
 * Only `terminal:run`'s exit-code marker needs this, and it needs it to be
 * conservative: an unrecognised shell must come back as `unknown` and lose the
 * exit code, rather than be guessed at as POSIX and have `$?` land in the
 * user's prompt as literal text.
 */
export type ShellFamily = 'posix' | 'fish' | 'powershell' | 'cmd' | 'unknown'

export function shellFamily(profile: { id: string; path: string }): ShellFamily {
  const name = basename(profile.path).replace(/\.exe$/i, '').toLowerCase()
  if (name === 'fish') return 'fish'
  if (name === 'pwsh' || name === 'powershell') return 'powershell'
  if (name === 'cmd') return 'cmd'
  if (name === 'bash' || name === 'zsh' || name === 'sh' || name === 'dash' || name === 'ksh') {
    return 'posix'
  }
  // WSL launches the distro's default shell, which is overwhelmingly a POSIX
  // one; `wsl.exe` itself is not a shell and has no name to match on.
  if (profile.id === 'wsl' || profile.id === 'git-bash') return 'posix'
  return 'unknown'
}
