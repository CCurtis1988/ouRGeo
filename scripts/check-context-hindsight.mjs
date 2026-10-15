// Synthetic isolated acceptance; dependencies are provisioned separately.
// Cleanup targets only the exact legacy fixture this work created.
if (process.argv.includes('--stop-legacy-fixture')) {
  const { readdir, readFile, readlink } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  const root = resolve(import.meta.dirname, '..'), stopped = []
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue
    try {
      const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean)
      const status = await readFile(`/proc/${pid}/status`, 'utf8')
      if (argv.length !== 2 || !argv[0].endsWith('/.cache/stage34/hindsight/venv/bin/python') && argv[0] !== '.cache/stage34/hindsight/venv/bin/python'
        || argv[1] !== '.cache/stage34/hindsight/run-fixture.py' || await readlink(`/proc/${pid}/cwd`) !== root || Number(status.match(/^Uid:\s+(\d+)/m)?.[1]) !== process.getuid()) continue
      process.kill(Number(pid), 'SIGTERM'); stopped.push(Number(pid))
    } catch { /* A nonmatching or already exited process is never signalled. */ }
  }
  console.log(JSON.stringify({ stoppedLegacySyntheticFixtures: stopped }))
} else await import('./check-context-hindsight-isolated.mjs')
