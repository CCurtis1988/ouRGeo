// Which environment the console runs code in.
//
// R looks a name up OUTWARDS — from the environment the code is evaluating in,
// through its parent, on to the attached packages — and never into an
// environment sitting inside .GlobalEnv. So once `x` has been moved into
// `env2`, typing `x * a` at a .GlobalEnv prompt is an error, and the only ways
// to reach it are `env2$x`, `with(env2, x * a)` or `eval(quote(x * a), env2)`.
//
// That is correct R and it is also a wall for someone who has just discovered
// environments. Working IN the environment removes the wall without bending
// anything: every environment ouRGeo creates has .GlobalEnv as its parent, so
// code evaluated inside `env2` sees `env2`'s objects AND everything in
// .GlobalEnv — `x * a` is 6, exactly as it would be after `evalq(x * a, env2)`.
//
// The setting lives on `rClient` as well as in the store, because the console,
// the toolbox and the AI assistant all run R through `rClient.execute`: a tool
// that wrote its result into .GlobalEnv while the user was working in `env2`
// would put the object somewhere they are not looking.

import { rClient } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import { GLOBAL_ENV } from '@/lib/environments'

export function workingEnv(): string {
  return useSessionStore.getState().workingEnv
}

/**
 * Point the console at an environment, and show the R for it.
 *
 * There is no R command that moves the prompt — R's REPL always evaluates in
 * .GlobalEnv — so the echo is the thing ouRGeo now does to every command:
 * `evalq(expr, env)`. It is written as a real, runnable block rather than a
 * sentence about one, because that is the idiom the user needs when they are
 * NOT in ouRGeo (in a script, in a chunk, in someone else's console), and the
 * console is where they will look for it. The braces carry the explanation, so
 * pasting the echoed line back into R is harmless.
 */
export function setWorkingEnv(name: string): void {
  const previous = workingEnv()
  if (name === previous) return
  useSessionStore.getState().setWorkingEnv(name)
  rClient.setWorkingEnv(name)
  useSessionStore.getState().addConsoleEntry('input', name === GLOBAL_ENV
    ? [
        'evalq({',
        `  # back in ${GLOBAL_ENV} — objects in other environments are env$name again`,
        `}, ${GLOBAL_ENV})`,
      ].join('\n')
    : [
        'evalq({',
        `  # everything you type from here runs inside ${name} — its objects can be`,
        `  # named directly, and ${GLOBAL_ENV} is still visible through it`,
        `}, ${name})`,
      ].join('\n'))
}

/**
 * Drop the setting when the environment goes away — a `rm()`, a project load,
 * an R restart.
 *
 * Without this the next command fails with "Environment 'env2' not found" and
 * nothing on screen explains why, because the environment it names is no
 * longer in the panel to be seen.
 */
export function pruneWorkingEnv(names: string[]): void {
  const current = workingEnv()
  if (current === GLOBAL_ENV || names.includes(current)) return
  useSessionStore.getState().setWorkingEnv(GLOBAL_ENV)
  rClient.setWorkingEnv(GLOBAL_ENV)
  useSessionStore.getState().addConsoleEntry(
    'info',
    `${current} is gone — the console is working in ${GLOBAL_ENV} again.`,
  )
}
