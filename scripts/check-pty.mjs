// Refuse to package an installer whose terminal would not work.
//
// `@lydell/node-pty` ships one prebuilt binary per platform as
// `optionalDependencies`, so `npm install` fetches only the binary for the
// machine doing the installing. That keeps the install at ~160 KB instead of
// the ~27 MB the all-platforms package costs — and it means a CROSS-built
// installer (packaging for Windows from Linux) is assembled with no Windows
// binary present, ships happily, and fails at the user's first click on the
// Terminal button.
//
// electron-builder cannot catch that: from its point of view the file is
// simply not there to copy, which is indistinguishable from a file we never
// wanted. So the check is here, before the build, where the failure can name
// the fix instead of reaching a user as a broken panel.

import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const target = process.argv[2] ?? process.platform
const arch = process.argv[3] ?? process.arch
const pkg = `@lydell/node-pty-${target}-${arch}`

// Resolve the package ENTRY, not its package.json: these packages declare
// `"exports": "./lib/index.js"`, and a bare string export map makes every other
// path — package.json included — unresolvable. Resolution does not consult the
// `os`/`cpu` fields, so this correctly finds a foreign-platform binary that was
// installed deliberately for a cross build.
let found = true
try {
  require.resolve(pkg)
} catch {
  found = false
}

if (!found) {
  console.error(`
✖ Cannot package for ${target}-${arch}: the terminal backend for that platform
  is not installed.

  ouRGeo's terminal needs ${pkg}, and npm installs only
  the binary matching the machine it ran on. Build each installer on its own
  OS, or fetch the target's binary first:

      npm install --no-save ${pkg}

  Packaging without it produces an app whose Terminal panel cannot open a shell.
`)
  process.exit(1)
}

console.log(`✓ terminal backend present for ${target}-${arch}`)
