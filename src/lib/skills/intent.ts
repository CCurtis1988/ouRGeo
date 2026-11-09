// What the user's message says about skills, decided by the host, never the model.
//
// Invocation is the most reliable way a skill reaches a weak model: if the user
// names one, the host attaches it, and the model never has to choose (Hermes and
// Claude Code do the same with `/name`). The patterns are deliberately narrow: a
// skill word has to be next to "skill", or after a slash, so an ordinary sentence
// containing "maps" does not attach the maps skill.

export interface Invocation {
  /** Names as the user wrote them, in order; resolved against the library by the caller. */
  names: string[]
  /** The message with a leading `/name` removed, so the model reads the request itself. */
  text: string
}

// `/name` then a space or the end: `/home/me/data.csv` is a path, not a skill.
const SLASH = /^\/([a-z0-9][a-z0-9:-]{0,63})(?:\s+|$)/i
// "use your short-report skill", "apply the field check skill", "with my short report skill"
// A name word is never a filler word, or "run it with the x skill" names "it with the x".
const WORD = String.raw`(?!(?:your|the|my|our|this|that|it|with|a|an|to|on|for|please)\b)[a-z0-9][\w-]*`
const NAMED = new RegExp(String.raw`\b(?:use|using|apply|applying|run|follow|with|via)\s+(?:(?:your|the|my|our|this)\s+)?["'\`]?(${WORD}(?:[ -]${WORD}){0,3}?)["'\`]?\s+skill\b`, 'gi')
// "the short-report skill" in a request that is not about making one
const BARE = /\b(?:the|your|my)\s+["'`]?([a-z0-9][\w-]*(?:-[\w-]+)+)["'`]?\s+skill\b/gi

export function parseSkillInvocation(message: string): Invocation {
  const names: string[] = []
  let text = message
  const slash = message.match(SLASH)
  if (slash) { names.push(slash[1]); text = message.slice(slash[0].length).trim() || message }
  if (!isSkillSaveRequest(message)) {
    for (const match of message.matchAll(NAMED)) names.push(match[1])
    for (const match of message.matchAll(BARE)) names.push(match[1])
  }
  return { names: [...new Set(names.map(n => n.trim()))], text }
}

/**
 * "Turn the report we just made into a skill", "save this as a skill called
 * short-report", "remember this workflow as a skill". Checked BEFORE the memory
 * hook, which would otherwise store the sentence itself as a one-line memory.
 */
export function isSkillSaveRequest(message: string): boolean {
  return /\b(?:turn|make|save|store|remember|record|capture|convert|keep|create|write)\b[^.?!]{0,80}\b(?:as|into|in(?:to)? a|a new)\s+(?:a\s+|new\s+)?(?:reusable\s+)?skill\b/i.test(message)
    || /\b(?:create|make|write|add)\s+(?:a\s+|me\s+a\s+)?(?:new\s+)?skill\b/i.test(message)
}

export interface DigestSource {
  /** This chat's messages, oldest first. */
  messages: { role: 'user' | 'assistant'; content: string; timestamp: number; toolCalls?: { code: string }[] }[]
  /** Console lines since the chat began: what the assistant ran and did. */
  console: { type: string; text: string; timestamp: number; origin?: string }[]
  since: number
}

/**
 * What this conversation actually did, for turning it into a skill. Earlier turns
 * are re-sent as plain text without their tool calls, so without this the model
 * cannot see the R it ran or the documents it wrote. Bounded, newest kept.
 */
export function workflowDigest(source: DigestSource, maxChars = 6000): string {
  const steps: string[] = []
  for (const message of source.messages) {
    if (message.role === 'user') steps.push(`User asked: ${message.content.replace(/\s+/g, ' ').slice(0, 300)}`)
    for (const call of message.toolCalls ?? []) if (call.code.trim()) steps.push(`R that ran:\n${call.code.trim().slice(0, 1200)}`)
  }
  for (const entry of source.console) {
    if (entry.timestamp < source.since || entry.origin !== 'ai' || entry.type !== 'info') continue
    if (/^AI: (wrote|edited|ran|added|created|set|interface|toolbox|ui:|map:|document)/i.test(entry.text)) steps.push(entry.text.slice(0, 200))
  }
  let out = steps.join('\n\n')
  if (out.length > maxChars) out = `(earlier steps omitted)\n\n${out.slice(out.length - maxChars)}`
  return out
    ? `Workflow digest of this conversation, for writing a skill (generalise it: replace dataset and column names with placeholders, keep the R as templates):\n\n${out}`
    : ''
}
