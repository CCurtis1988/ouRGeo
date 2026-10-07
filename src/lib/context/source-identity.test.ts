import { expect, it } from 'vitest'
import { conversationSourceId, environmentSourceId } from './source-identity'

it('keeps structured resource identities distinct when names contain separators', () => {
  const names = ['a', 'a:b', 'b:c', 'c', '::', '%3A', 'a b', 'á', '.GlobalEnv']
  for (const identity of [environmentSourceId, conversationSourceId]) {
    const ids = names.flatMap(first => names.map(second => identity(first, second)))
    expect(new Set(ids).size).toBe(names.length ** 2)
  }
  expect(environmentSourceId('.GlobalEnv', 'roads')).toBe('environment:.GlobalEnv:roads')
})
