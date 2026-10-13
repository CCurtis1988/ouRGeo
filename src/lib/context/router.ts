export interface ContextRoute { topics: string[]; environment: boolean; console: boolean; documents: boolean; memory: boolean }

/** Multi-label routing has no I/O. General R and synthetic examples deliberately
 * match no source; installed corpus size cannot change that decision. */
export function routeContext(text: string): ContextRoute {
  const topics: string[] = []
  if (/(?:theme|palette|colour scheme|color scheme|appearance|autumn.*(?:colours|colors))/i.test(text)) topics.push('themes')
  const documents = /(?:\bknit\b|\brmarkdown\b|\.Rmd\b|\.qmd\b|\breport\b|\bdocument\b|markdown|write.?up)/i.test(text)
  if (documents) topics.push('documents')
  if (/\bplugin\b/i.test(text)) topics.push('extending')
  return {
    topics,
    environment: /\[[^\]\n]+\]|\b(?:this|active|selected) (?:layer|dataset|object)\b|\b(?:columns|schema|crs|workspace|environment)\b/i.test(text),
    console: /\b(?:error|failed|failure|warning|debug|console)\b/i.test(text),
    documents,
    memory: /\b(?:remember|yesterday|previous|earlier|decid|prefer|units|distance|length|area|buffer|CRS|projection|format|style)\w*\b/i.test(text),
  }
}

export function lexicalScore(query: string, title: string, summary: string): number {
  return scoreLexicalQuery(prepareLexicalQuery(query), title.toLowerCase(), summary.toLowerCase())
}

export interface LexicalQuery { text: string; words: string[] }
export function prepareLexicalQuery(query: string): LexicalQuery {
  const text = query.toLowerCase().trim()
  return { text, words: [...new Set(text.match(/[\p{L}\p{N}_.:$-]+/gu) ?? [])].filter(word => word.length > 1) }
}
/** Prepared once per search; names and summaries are already lower case. */
export function scoreLexicalQuery(query: LexicalQuery, name: string, summary: string, asciiSummaryPatterns?: readonly RegExp[]): number {
  if (!query.text) return 1
  let score = name === query.text ? 100 : name && query.text.includes(name) ? 40 : 0
  for (let index = 0; index < query.words.length; index++) {
    const word = query.words[index]
    score += name.includes(word) ? 8 : (asciiSummaryPatterns ? asciiSummaryPatterns[index].test(summary) : summary.includes(word)) ? 2 : 0
  }
  return score
}

/** Declarative aliases are local routing data, never extra prompt content.
 * An exclusion wins over a positive alias. Generic descriptor matches stay
 * discoverable through search instead of causing speculative body prefetch. */
export function routeSkillDescriptors(text: string, descriptors: { topic: string; triggers: string[]; exclusions: string[] }[]): string[] {
  const normalise = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const query = ` ${normalise(text)} `
  return descriptors.filter(descriptor => !descriptor.exclusions.some(alias => alias && query.includes(` ${normalise(alias)} `))
    && descriptor.triggers.some(alias => alias && query.includes(` ${normalise(alias)} `))).slice(0, 3).map(descriptor => descriptor.topic)
}
