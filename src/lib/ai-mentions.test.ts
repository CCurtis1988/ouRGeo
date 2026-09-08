import { describe, it, expect } from 'vitest'
import { detectMentionedObjects } from './ai-client'
import type { REnvironmentInfo } from '@/lib/r-client'

const env = (name: string, isSearchPath: boolean, objects: string[]): REnvironmentInfo =>
  ({
    name, isSearchPath,
    objects: objects.map((n) => ({ name: n, class: 'data.frame', preview: '' })),
  }) as unknown as REnvironmentInfo

const SESSION = [
  env('.GlobalEnv', false, ['roads', 'pts', 'ab']),
  // What `/env/list` actually returns beside it.
  env('package:base', true, ['with', 'data', 'table', 'max', 'format', 'c', 't']),
  env('package:stats', true, ['filter', 'sd', 'var']),
]

describe('which objects a message is asking about', () => {
  it('finds the user’s own, named plainly or in brackets', () => {
    expect(detectMentionedObjects('buffer roads by 50m', SESSION)).toEqual(['roads'])
    expect(detectMentionedObjects('summarise [pts]', SESSION)).toEqual(['pts'])
  })

  it('never matches a package function, however ordinary the word', () => {
    // The bug: "Reply with one word" asked R for the first five rows of
    // base::with. R refuses, the preview is dropped silently, and the doomed
    // round trip has already queued on a SERIAL R server — which is the wait
    // that makes a user click Send twice.
    const msg = 'Reply with one word and format the max value in the data table'
    expect(detectMentionedObjects(msg, SESSION)).toEqual([])
  })

  it('ignores a one-letter word, which is English as often as it is a name', () => {
    const withShort = [...SESSION, env('.GlobalEnv', false, ['a'])]
    expect(detectMentionedObjects('what is a buffer?', withShort)).toEqual([])
    // …unless the user asked for it by name.
    expect(detectMentionedObjects('show [a]', withShort)).toEqual(['a'])
  })

  it('names each object once, however often it appears', () => {
    expect(detectMentionedObjects('roads, then roads again, and [roads]', SESSION))
      .toEqual(['roads'])
  })
})
