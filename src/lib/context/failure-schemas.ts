import type { ContextSource } from './types'

/** Inspect only the two named inputs of a recognisable recorded join. Error
 * prose, quoted examples, dynamic expressions and ambiguous names cannot select
 * unrelated schemas. These are current observations, not proof of past state. */
export function failureSchemas(failures: ContextSource[], objects: ContextSource[], excluded: string[]): string[] {
  const denied = new Set(excluded)
  const available = (source: ContextSource): boolean => !denied.has(source.id) && !source.legacyIds?.some(id => denied.has(id))
  const name = '[\\p{L}_.][\\p{L}\\p{N}_.]*'
  const reference = `(${name}(?:\\s*\\$\\s*${name})?)`
  const join = new RegExp(`^\\s*(?:${name}\\s*(?:<-|=)\\s*)?(?:dplyr\\s*::\\s*)?(?:left_join|right_join|inner_join|full_join|semi_join|anti_join)\\s*\\(\\s*${reference}\\s*,\\s*${reference}\\s*(?:,|\\))`, 'u')
  const ids: string[] = []
  for (const failure of failures.filter(available)) {
    if (failure.kind !== 'console' || !/^Fail(?:ure|ed)\b/u.test(failure.title) || !failure.command || failure.command.length > 4000 || /[;\n#]/.test(failure.command)) continue
    const match = join.exec(failure.command)
    if (!match) continue
    for (const argument of [match[1], match[2]]) {
      const parts = argument.split(/\s*\$\s*/)
      const matches = objects.filter(object => available(object) && object.kind === 'environment' && object.resource?.name === parts.at(-1)
        && (parts.length === 1 || object.resource?.environment === parts[0]))
      if (matches.length === 1 && !ids.includes(matches[0].id)) ids.push(matches[0].id)
      if (ids.length === 2) return ids
    }
  }
  return ids
}
