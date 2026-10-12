import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { packageResults } from './health-check'
import type { RHealth } from './health-types'

const health: RHealth = { path: 'Rscript', version: '4.6.1', supported: true, configuredPathBroken: false,
  packages: [{ name: 's2', group: 'Spatial', version: '1.1.13', available: '1.1.13', built: '4.6.1', loaded: true, reason: '' }],
  duplicates: [], updatesChecked: true, library: '/R', libraryWritable: true, tools: { pandoc: false, latex: false } }
it('reports a failed native geometry test even when the S2 namespace loads', () => {
  const result = packageResults({ ...health, s2: { ok: false, detail: 'Buffer failed', repair: 'Linux: rebuild with bundled Abseil', library: '/active/R' } })
  expect(result.find((r) => r.id === 's2-engine')).toMatchObject({ status: 'error', detail: expect.stringContaining('Buffer failed') })
  expect(result.find((r) => r.id === 's2-engine')?.detail).toContain('bundled Abseil')
  expect(packageResults({ ...health, s2: { ok: true, detail: 'Buffers passed', repair: '', library: '/R' } }).find((r) => r.id === 's2-engine')?.status).toBe('pass')
})

const rscript = process.platform === 'win32' ? 'Rscript.exe' : 'Rscript'
let hasR = false
try { execFileSync(rscript, ['--version'], { stdio: 'ignore' }); hasR = true } catch { /* optional on CI */ }
describe.skipIf(!hasR)('independent S2 health and platform repairs', () => {
  const run = (code: string, vanilla = true) => execFileSync(rscript, [...(vanilla ? ['--vanilla'] : []), '-e', `source('r/lib/health-s2.R'); ${code}`], { timeout: 30_000, encoding: 'utf8' })
  it('preserves the native loader failure for a missing Abseil library', () => {
    run(`loadNamespace <- function(...) stop('libabsl_flags_internal.so.2605.0.0: cannot open shared object file')
      probe <- health_s2_probe()
      stopifnot(!probe$ok, !probe$loaded, grepl('libabsl_flags_internal', probe$detail))`)
  })
  it('uses compatible binaries on Windows and macOS and restores Linux build settings on failure', () => {
    run(`calls <- list()
      install <- function(...) { calls[[length(calls) + 1L]] <<- list(...) }
      for (os in c('windows', 'macos')) {
        health_s2_repair('/fixture library', os, 'binary', install)
        stopifnot(identical(tail(calls, 1)[[1]], list('s2', lib = '/fixture library', type = 'binary')))
        failure <- try(health_s2_repair('/fixture', os, 'source', install), silent = TRUE)
        stopifnot(inherits(failure, 'try-error'), grepl('does not support CRAN binaries', failure))
      }
      tools <- function(x) setNames(rep('/fixture/tool', length(x)), x)
      Sys.setenv(S2_FORCE_BUNDLED_ABSEIL = 'false')
      source_install <- function(...) { stopifnot(Sys.getenv('S2_FORCE_BUNDLED_ABSEIL') == 'true'); install(...) }
      health_s2_repair('/fixture', 'linux', 'source', source_install, tools)
      stopifnot(tail(calls, 1)[[1]]$type == 'source', Sys.getenv('S2_FORCE_BUNDLED_ABSEIL') == 'false')
      broken_install <- function(...) stop('download failed')
      stopifnot(inherits(try(health_s2_repair('/fixture', 'linux', 'source', broken_install, tools), silent = TRUE), 'try-error'))
      stopifnot(Sys.getenv('S2_FORCE_BUNDLED_ABSEIL') == 'false')
      Sys.unsetenv('S2_FORCE_BUNDLED_ABSEIL')
      health_s2_repair('/fixture', 'linux', 'source', source_install, tools)
      stopifnot(is.na(Sys.getenv('S2_FORCE_BUNDLED_ABSEIL', unset = NA_character_)))
      missing <- function(x) setNames(rep('', length(x)), x)
      before <- length(calls)
      failure <- try(health_s2_repair('/fixture', 'linux', 'source', install, missing), silent = TRUE)
      stopifnot(length(calls) == before, grepl('Missing S2 build tools', failure))
      stopifnot(health_s2_platform('Windows') == 'windows', health_s2_platform('Darwin') == 'macos', health_s2_platform('Linux') == 'linux')`)
  })
  it('replaces the active custom-library copy instead of installing a shadowed copy', () => {
    run(`root <- tempfile('s2-libraries-'); dir.create(root)
      libs <- file.path(root, c('custom', 'user')); invisible(lapply(libs, dir.create))
      dir.create(file.path(libs[1], 's2'))
      stopifnot(identical(health_s2_library(libs[2], libs), libs[1]))
      file.access <- function(path, mode) ifelse(path %in% c(libs[1], file.path(libs[1], 's2')), -1L, 0L)
      blocked <- try(health_s2_library(libs[2], libs), silent = TRUE)
      stopifnot(inherits(blocked, 'try-error'), grepl('configure a writable library before it', blocked))
      # A writable library before the protected active copy can override it.
      stopifnot(identical(health_s2_library(libs[2], rev(libs)), libs[2]))
      unlink(root, recursive = TRUE)`)
  })
  it('checks real spherical distance, buffering and a loaded engine returning incorrect results', () => {
    const output = run(`if (!requireNamespace('s2', quietly = TRUE)) { cat('NO_S2'); quit(status = 0) }
      probe <- health_s2_probe(); stopifnot(probe$ok, probe$loaded)
      ns <- asNamespace('s2'); original <- get('s2_distance', ns)
      unlockBinding('s2_distance', ns); assign('s2_distance', function(...) 0, ns); lockBinding('s2_distance', ns)
      bad <- health_s2_probe()
      unlockBinding('s2_distance', ns); assign('s2_distance', original, ns); lockBinding('s2_distance', ns)
      stopifnot(!bad$ok, bad$loaded, grepl('distance test', bad$detail)); cat('ENGINE_OK')`, false)
    if (!output.includes('NO_S2')) expect(output).toContain('ENGINE_OK')
  })
})
