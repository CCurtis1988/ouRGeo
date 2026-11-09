import { describe, expect, it } from 'vitest'
import { isSkillSaveRequest, parseSkillInvocation, workflowDigest } from './intent'

describe('invoking a skill by name', () => {
  it.each([
    ['Please use your short-report skill to summarize this data', ['short-report']],
    ['use the short report skill on nc', ['short report']],
    ['Can you apply my field-check skill?', ['field-check']],
    ['run it with the short-report skill please', ['short-report']],
  ])('%s', (message, names) => {
    expect(parseSkillInvocation(message).names).toEqual(names)
  })
  it('takes a leading slash command and passes on the rest of the request', () => {
    expect(parseSkillInvocation('/short-report summarise nc')).toEqual({ names: ['short-report'], text: 'summarise nc' })
  })
  it.each([
    'show me the maps',
    'what skills do you have?',
    'add nc to the map and colour it by BIR74',
    'path is /home/me/data.csv',
    '/home/me/data.csv is the file',
  ])('does not attach anything for: %s', message => {
    expect(parseSkillInvocation(message).names).toEqual([])
  })
  it('a request to MAKE a skill is not an invocation of it', () => {
    const message = 'Please turn the report we just worked on into a skill for analyzing data and creating a report, call it the short-report skill'
    expect(isSkillSaveRequest(message)).toBe(true)
    expect(parseSkillInvocation(message).names).toEqual([])
  })
})

describe('asking for a skill to be saved', () => {
  it.each([
    'Please turn the report we just worked on into a skill',
    'remember this workflow as a skill',
    'save that as a reusable skill called field-check',
    'create a skill for cleaning survey data',
    'make me a new skill that writes a short report',
  ])('%s', message => expect(isSkillSaveRequest(message)).toBe(true))
  it.each([
    'remember that I prefer metric units',
    'I have a lot of skill with R',
    'which skill should I use?',
  ])('not: %s', message => expect(isSkillSaveRequest(message)).toBe(false))
})

describe('the workflow digest', () => {
  it('lists what the user asked and the R that ran, and only the assistant\'s own actions', () => {
    const digest = workflowDigest({
      since: 0,
      messages: [{ role: 'user', content: 'Summarise nc', timestamp: 1 }, { role: 'assistant', content: 'Done', timestamp: 2, toolCalls: [{ code: 'summary(nc$BIR74)' }] }],
      console: [{ type: 'info', text: 'AI: wrote report.Rmd', timestamp: 3, origin: 'ai' }, { type: 'info', text: 'AI: wrote something', timestamp: 3, origin: 'user' }],
    })
    expect(digest).toMatch(/User asked: Summarise nc/)
    expect(digest).toMatch(/summary\(nc\$BIR74\)/)
    expect(digest).toMatch(/AI: wrote report\.Rmd/)
    expect(digest).not.toMatch(/wrote something/)
  })
  it('keeps the newest steps when it is too long, and is empty for an empty chat', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ role: 'user' as const, content: `step ${i} ${'x'.repeat(100)}`, timestamp: i }))
    const digest = workflowDigest({ since: 0, messages: many, console: [] }, 1000)
    expect(digest).toMatch(/earlier steps omitted/)
    expect(digest).toMatch(/step 49/)
    expect(workflowDigest({ since: 0, messages: [], console: [] })).toBe('')
  })
})
