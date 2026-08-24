import { describe, it, expect } from 'vitest'
import { analyzeContext, type Context } from './context'

/**
 * Split a string with a `|` caret marker into [text, offset]. Uses the LAST
 * `|` so it doesn't collide with the `|>` native pipe (the caret always sits to
 * the right of any pipe in these fixtures).
 */
function cur(s: string): [string, number] {
  const i = s.lastIndexOf('|')
  return [s.slice(0, i) + s.slice(i + 1), i]
}

const frames = (...names: string[]) => (n: string) => names.includes(n)
const analyze = (s: string, known = frames('meuse', 'df', 'nc')): Context => {
  const [text, off] = cur(s)
  return analyzeContext(text, off, known)
}

describe('analyzeContext — member access', () => {
  it('completes columns after $ with empty prefix', () => {
    const c = analyze('meuse$|')
    expect(c).toMatchObject({ type: 'member', object: 'meuse', prefix: '', quoted: false })
  })
  it('completes columns after $ with a prefix', () => {
    expect(analyze('meuse$ele|')).toMatchObject({ type: 'member', object: 'meuse', prefix: 'ele' })
  })
  it('completes columns inside [[" quotes', () => {
    expect(analyze('df[["ele|')).toMatchObject({
      type: 'member',
      object: 'df',
      prefix: 'ele',
      quoted: true,
    })
  })
})

describe('analyzeContext — namespace', () => {
  it('detects pkg:: exports', () => {
    expect(analyze('sf::st_re|')).toMatchObject({ type: 'namespace', pkg: 'sf', prefix: 'st_re' })
  })
  it('detects pkg::: exports', () => {
    expect(analyze('dplyr:::foo|')).toMatchObject({ type: 'namespace', pkg: 'dplyr' })
  })
})

describe('analyzeContext — dplyr / ggplot column context', () => {
  it('resolves the piped source frame (native pipe)', () => {
    expect(analyze('meuse |> filter(ele|')).toMatchObject({ type: 'column', frames: ['meuse'] })
  })
  it('resolves through a multi-step magrittr chain', () => {
    const c = analyze('meuse %>% group_by(x) %>% summarise(m|')
    expect(c).toMatchObject({ type: 'column', frames: ['meuse'] })
  })
  it('resolves the ggplot data arg from inside aes()', () => {
    expect(analyze('ggplot(meuse, aes(ele|')).toMatchObject({ type: 'column', frames: ['meuse'] })
  })
  it('resolves a piped ggplot: df %>% ggplot(aes())', () => {
    expect(analyze('meuse %>% ggplot(aes(x|')).toMatchObject({ type: 'column', frames: ['meuse'] })
  })
  it('uses the first positional arg when not piped', () => {
    expect(analyze('filter(meuse, ele|')).toMatchObject({ type: 'column', frames: ['meuse'] })
  })
  it('falls back to argument context when the receiver is not a known frame', () => {
    const c = analyze('unknownthing |> filter(x|')
    expect(c.type).not.toBe('column')
    expect(c).toMatchObject({ type: 'argument', fn: 'filter' })
  })
})

describe('analyzeContext — argument position', () => {
  it('offers argument names right after (', () => {
    expect(analyze('st_read(|')).toMatchObject({ type: 'argument', fn: 'st_read', prefix: '' })
  })
  it('offers argument names while typing a name', () => {
    expect(analyze('st_read(ds|')).toMatchObject({ type: 'argument', fn: 'st_read', prefix: 'ds' })
  })
  it('is not an argument-name position once past an = (value side)', () => {
    const c = analyze('paste(sep = va|')
    expect(c.type).toBe('identifier')
  })
})

describe('analyzeContext — package argument context', () => {
  it('detects a bare package name in library()', () => {
    expect(analyze('library(dpl|')).toMatchObject({ type: 'package', prefix: 'dpl', quoted: false })
  })
  it('detects a quoted package name in require()', () => {
    expect(analyze('require("s|')).toMatchObject({ type: 'package', prefix: 's', quoted: true })
  })
  it('detects a quoted package name in install.packages()', () => {
    expect(analyze('install.packages("dpl|')).toMatchObject({ type: 'package', quoted: true })
  })
  it('sees through suppressPackageStartupMessages(library())', () => {
    expect(analyze('suppressPackageStartupMessages(library(sf|')).toMatchObject({ type: 'package' })
  })
  it('allows every positional arg of p_load (multi-package)', () => {
    expect(analyze('p_load(dplyr, s|')).toMatchObject({ type: 'package', prefix: 's' })
  })
  it('does not treat a named 2nd arg of library() as a package', () => {
    const c = analyze('library(dplyr, quie|')
    expect(c.type).not.toBe('package')
  })
  it('does not offer packages inside a non-package call', () => {
    expect(analyze('mean(dpl|').type).not.toBe('package')
  })
})

describe('analyzeContext — plain identifier and dead zones', () => {
  it('completes a bare identifier', () => {
    expect(analyze('me|')).toMatchObject({ type: 'identifier', prefix: 'me' })
  })
  it('does not complete inside a comment', () => {
    expect(analyze('x <- 1 # note me|').type).toBe('none')
  })
  it('does not complete inside an ordinary string', () => {
    expect(analyze('read("me|').type).toBe('none')
  })
})
