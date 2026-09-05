import { describe, it, expect } from 'vitest'
import { buildRunLine, parseRunMarker, isRunMarker, stripRunEcho, RUN_OSC } from './run-markers'

const ESC = String.fromCharCode(27)

describe('the line typed for a command', () => {
  it('never puts a raw escape byte on the command line', () => {
    // The bug this exists to prevent: to a line editor an ESC is not a
    // character, it is the start of a meta sequence. Writing one into bash's
    // readline enters a key binding instead of inserting text, and the command
    // silently becomes something else.
    // Anything below space, other than the trailing carriage return that IS
    // the Enter key.
    const controls = new RegExp(
      '[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + ']',
    )
    for (const family of ['posix', 'fish', 'powershell', 'cmd'] as const) {
      const { text } = buildRunLine('ls', family)
      expect(text.replace(/\r$/, ''), family).not.toMatch(controls)
    }
  })

  it('ends with a carriage return, which is what Enter is on a terminal', () => {
    expect(buildRunLine('ls', 'posix').text.endsWith('\r')).toBe(true)
    // A bare \n works in most shells and silently does nothing in some line
    // editors — the worse of the two failure modes.
    expect(buildRunLine('ls', 'posix').text).not.toContain('\n')
  })

  it('asks a POSIX shell for $? and fish for $status', () => {
    // Each is empty and harmless in the other, so getting this wrong produces
    // no error at all — just a marker that never carries a code.
    expect(buildRunLine('ls', 'posix').text).toContain('"$?"')
    expect(buildRunLine('ls', 'fish').text).toContain('"$status"')
    expect(buildRunLine('ls', 'fish').text).not.toContain('"$?"')
  })

  it('runs the marker even when the command fails', () => {
    // `;` not `&&`: a command that exits non-zero is exactly the case where
    // the exit code is worth having.
    expect(buildRunLine('false', 'posix').text).toContain('false ; printf')
  })

  it('combines PowerShell’s two notions of failure', () => {
    // `$?` there is a boolean and `$LASTEXITCODE` is only set by native
    // programs, so a failed cmdlet would otherwise be reported as 0.
    const text = buildRunLine('Get-Item nope', 'powershell').text
    expect(text).toContain('$LASTEXITCODE')
    expect(text).toContain('if ($?)')
  })

  it('still runs the command on a shell it cannot instrument', () => {
    // Losing the exit code is not a reason to refuse to do the thing that was
    // asked; the caller is told, and says "finished" instead of claiming a
    // status it invented.
    for (const family of ['cmd', 'unknown'] as const) {
      const line = buildRunLine('dir', family)
      expect(line.reportsExitCode, family).toBe(false)
      expect(line.text, family).toBe('dir\r')
    }
  })

  it('reports that it can instrument the shells it can', () => {
    expect(buildRunLine('ls', 'posix').reportsExitCode).toBe(true)
    expect(buildRunLine('ls', 'fish').reportsExitCode).toBe(true)
    expect(buildRunLine('ls', 'powershell').reportsExitCode).toBe(true)
  })

  it('uses a private OSC number rather than a printable sentinel', () => {
    // `echo "OURGEO-DONE"` must not end a run, and a sequence is also not
    // drawn — so the user sees their command's output and nothing else.
    expect(buildRunLine('ls', 'posix').text).toContain(`]${RUN_OSC};`)
  })
})

describe('reading the marker back', () => {
  it('takes the exit code out of the payload', () => {
    expect(parseRunMarker('ourgeo-done;0')).toBe(0)
    expect(parseRunMarker('ourgeo-done;127')).toBe(127)
  })

  it('reports no code rather than coercing one', () => {
    // On a shell that did not understand the syntax the payload is the literal
    // text of the expression, and `NaN` presented as an exit status would be
    // worse than silence.
    expect(parseRunMarker('ourgeo-done;$?')).toBeNull()
    expect(parseRunMarker('ourgeo-done;')).toBeNull()
    expect(parseRunMarker('something-else;0')).toBeNull()
  })

  it('recognises our own payloads and nothing else', () => {
    expect(isRunMarker('ourgeo-done;0')).toBe(true)
    expect(isRunMarker('0;some window title')).toBe(false)
  })
})

describe('what the model is shown', () => {
  it('drops the echoed command line, plumbing and all', () => {
    // Reporting `git status ; printf '\\033]697…'` back to a user who asked
    // for `git status` would be showing them our own machinery as if it were
    // theirs.
    const { text } = buildRunLine('git status', 'posix')
    const echoed = text.slice(0, -1)
    const output = `${echoed}\r\nOn branch main\r\n`
    expect(stripRunEcho(output, 'git status', 'posix')).toBe('On branch main\r\n')
  })

  it('leaves output alone when the echo is not there to find', () => {
    // A shell that does not echo, or output that arrived before the echo did.
    expect(stripRunEcho('just output', 'ls', 'posix')).toBe('just output')
  })

  it('leaves output alone for a shell with no marker', () => {
    expect(stripRunEcho(`dir${ESC}`, 'dir', 'cmd')).toBe(`dir${ESC}`)
  })
})
