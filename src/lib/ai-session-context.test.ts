import { describe, it, expect } from 'vitest'
import {
  consoleDelta, fullSessionContext, incrementalSessionContext, NOTHING_SENT,
  type SessionInput, type SentContext,
} from '@/lib/ai-session-context'
import type { ConsoleEntry } from '@/store/session'
import type { REnvironmentInfo } from '@/lib/r-client'
import type { TabState } from '@/store/editor'

const entry = (id: string, text: string, origin?: 'ai'): ConsoleEntry =>
  ({ id, type: 'input', text, timestamp: 0, ...(origin ? { origin } : {}) })

const env = (names: string[]): REnvironmentInfo[] => ([{
  name: '.GlobalEnv',
  isSearchPath: false,
  objects: names.map((n) => ({ name: n, class: 'data.frame', preview: 'a frame' })),
} as REnvironmentInfo])

const tab = (name: string, content: string): TabState =>
  ({ id: name, type: 'code', fileName: name, filePath: null, content, isDirty: false } as TabState)

const input = (over: Partial<SessionInput> = {}): SessionInput => ({
  environments: env(['pts']),
  consoleHistory: [entry('1', 'plot(pts)')],
  tabs: [],
  activeTabId: null,
  switches: '',
  previews: '',
  ...over,
})

describe('the console delta', () => {
  it('reports a capped tail when nothing has been said yet', () => {
    const all = Array.from({ length: 40 }, (_, i) => entry(String(i), `line ${i}`))
    const { fresh, mark } = consoleDelta(all, null)
    expect(fresh).toHaveLength(25)
    expect(fresh[0].text).toBe('line 15')
    expect(mark).toBe('39')
  })

  it('reports only what arrived after the mark', () => {
    const all = [entry('1', 'a'), entry('2', 'b'), entry('3', 'c')]
    const { fresh, mark } = consoleDelta(all, '1')
    expect(fresh.map((e) => e.text)).toEqual(['b', 'c'])
    expect(mark).toBe('3')
  })

  // The whole point of the module: with Autopilot on, the assistant's own
  // commands are most of the console, and it was handed every one of them as a
  // tool result. Sending them again bills the same bytes twice and leaves them
  // in the transcript to be re-read on every turn after.
  it('drops the assistant\'s own lines — it already has them as tool results', () => {
    const all = [
      entry('1', 'user typed this'),
      entry('2', 'the assistant ran this', 'ai'),
      entry('3', 'and this', 'ai'),
      entry('4', 'the user typed this too'),
    ]
    const { fresh, mark } = consoleDelta(all, null)
    expect(fresh.map((e) => e.text)).toEqual(['user typed this', 'the user typed this too'])
    // The mark still moves past them, or they are reconsidered — and dropped
    // again — on every turn for ever.
    expect(mark).toBe('4')
  })

  it('says nothing when every new line was the assistant\'s own', () => {
    const all = [entry('1', 'a'), entry('2', 'b', 'ai'), entry('3', 'c', 'ai')]
    const { fresh, mark } = consoleDelta(all, '1')
    expect(fresh).toEqual([])
    expect(mark).toBe('3')
  })

  // Ids keep counting up across `clearConsole`, so a mark from before a clear
  // can never match again. Sending nothing would leave the model believing in
  // output that has been wiped.
  it('starts over when the mark is gone, which is what a cleared console looks like', () => {
    const all = [entry('90', 'after the clear'), entry('91', 'and more')]
    const { fresh } = consoleDelta(all, '12')
    expect(fresh.map((e) => e.text)).toEqual(['after the clear', 'and more'])
  })

  it('keeps the mark when the console is empty', () => {
    expect(consoleDelta([], '5')).toEqual({ fresh: [], mark: '5' })
  })
})

describe('the incremental block', () => {
  it('sends everything the first time', () => {
    const { block, sent } = incrementalSessionContext(input(), NOTHING_SENT)
    expect(block).toContain('## R Environment')
    expect(block).toContain('`pts`')
    expect(block).toContain('## Recent Console')
    expect(sent.consoleMark).toBe('1')
    expect(sent.objects).toHaveProperty('.GlobalEnv::pts')
  })

  // The bug this module was written for: one console line moving used to
  // re-send the whole object listing, eleven times over a twelve-turn chat.
  it('does not repeat an environment that has not changed', () => {
    const first = incrementalSessionContext(input(), NOTHING_SENT)
    const next = incrementalSessionContext(
      input({ consoleHistory: [entry('1', 'plot(pts)'), entry('2', 'summary(pts)')] }),
      first.sent,
    )
    expect(next.block).toContain('## Recent Console')
    expect(next.block).toContain('summary(pts)')
    expect(next.block).not.toContain('## R Environment')
  })

  // The second half of the same argument, one level down. Autopilot creating a
  // result changes the listing, so the block IS sent — but a listing grows, and
  // re-sending sixteen objects to report the one that is new is the same waste
  // in a smaller box.
  it('names only the object that appeared, not the whole listing again', () => {
    const first = incrementalSessionContext(input(), NOTHING_SENT)
    const next = incrementalSessionContext(
      input({ environments: env(['pts', 'roads']) }), first.sent,
    )
    expect(next.block).toContain('`roads`')
    expect(next.block).not.toContain('`pts`')
    expect(next.block).toContain('still there, unchanged')
  })

  it('re-sends an object whose shape changed', () => {
    const grown: REnvironmentInfo[] = [{
      name: '.GlobalEnv', isSearchPath: false,
      objects: [{ name: 'pts', class: 'data.frame', dim: [99, 3], preview: 'a frame' }],
    } as REnvironmentInfo]
    const first = incrementalSessionContext(input(), NOTHING_SENT)
    const next = incrementalSessionContext(input({ environments: grown }), first.sent)
    expect(next.block).toContain('`pts`')
    expect(next.block).toContain('99×3')
  })

  it('names the environment when an object is not in .GlobalEnv', () => {
    const scratch: REnvironmentInfo[] = [
      ...env(['pts']),
      { name: 'scratch', isSearchPath: false,
        objects: [{ name: 'tmp', class: 'numeric', preview: '1 2 3' }] } as REnvironmentInfo,
    ]
    const first = incrementalSessionContext(input(), NOTHING_SENT)
    const next = incrementalSessionContext(input({ environments: scratch }), first.sent)
    // `scratch$tmp` and `tmp` are different names in generated R, so a delta
    // that dropped the environment would produce the wrong one.
    expect(next.block).toContain('### scratch')
    expect(next.block).toContain('`tmp`')
  })

  it('is silent when nothing at all has moved', () => {
    const first = incrementalSessionContext(input(), NOTHING_SENT)
    const next = incrementalSessionContext(input(), first.sent)
    expect(next.block).toBe('')
    expect(next.sent.objects).toEqual(first.sent.objects)
  })

  // A section that goes empty is a change the model has to hear, or it goes on
  // answering from a listing that no longer exists.
  it('says so when the environment empties out', () => {
    const first = incrementalSessionContext(input(), NOTHING_SENT)
    const next = incrementalSessionContext(input({ environments: [] }), first.sent)
    expect(next.block).toContain('No longer in the session')
    expect(next.block).toContain('`pts`')
    expect(next.sent.objects).toEqual({})
  })

  it('says so when the last document is closed', () => {
    const withDoc = input({ tabs: [tab('a.R', 'plot(1)')] })
    const first = incrementalSessionContext(withDoc, NOTHING_SENT)
    expect(first.block).toContain('## Open Documents')
    const next = incrementalSessionContext(input({ tabs: [] }), first.sent)
    expect(next.block).toContain('No documents are open')
  })

  // The misreading that a partial update invites, headed off in the frame.
  it('tells the model that an absent section is an unchanged one', () => {
    const { block } = incrementalSessionContext(input(), NOTHING_SENT)
    expect(block).toContain('A section that is not here has not changed')
    expect(block).toContain('not a replacement')
  })

  // The switch positions used to sit in the system prompt's tail, so flipping
  // Autopilot on part-way through a chat — the ordinary way to use the panel —
  // changed the cached prefix and re-sent the whole conversation as a cache
  // write. On the turn, a flip extends the prefix instead.
  it('states the switches once, then only when one is flipped', () => {
    const on = 'AUTOPILOT ON'
    const off = 'AUTOPILOT OFF'
    const first = incrementalSessionContext(input({ switches: off }), NOTHING_SENT)
    expect(first.block).toContain(off)

    const same = incrementalSessionContext(input({ switches: off }), first.sent)
    expect(same.block).not.toContain(off)

    const flipped = incrementalSessionContext(
      input({ switches: on, consoleHistory: [entry('1', 'plot(pts)'), entry('2', 'summary(pts)')] }),
      first.sent,
    )
    expect(flipped.block).toContain(on)
    // What the assistant may do leads the block, ahead of the state it applies to.
    expect(flipped.block.indexOf(on)).toBeLessThan(flipped.block.indexOf('## Recent Console'))
  })

  it('always carries the previews of objects named in this turn', () => {
    const prior: SentContext = { objects: {}, documents: '', switches: '', consoleMark: '1' }
    const { block } = incrementalSessionContext(
      input({ previews: '## Referenced Object Previews\n| a | b |' }), prior,
    )
    expect(block).toContain('Referenced Object Previews')
  })
})

describe('the full block', () => {
  it('carries every section, because its transport keeps no transcript', () => {
    const block = fullSessionContext(input({
      tabs: [tab('a.Rmd', '# Title\n')],
      previews: '## Referenced Object Previews\nx',
    }))
    expect(block).toContain('## R Environment')
    expect(block).toContain('## Recent Console')
    expect(block).toContain('## Open Documents')
    expect(block).toContain('## Referenced Object Previews')
  })

  it('includes the assistant\'s own console lines — there is no transcript holding them', () => {
    const block = fullSessionContext(input({
      consoleHistory: [entry('1', 'the assistant ran this', 'ai')],
    }))
    expect(block).toContain('the assistant ran this')
  })
})
