/** Separators in R names and imported chat IDs cannot become namespace
 * separators. The broker adds workspace/project leases independently. */
export function environmentSourceId(environment: string, object: string): string {
  return `environment:${encodeURIComponent(environment)}:${encodeURIComponent(object)}`
}
export function conversationSourceId(chat: string, message?: string): string {
  return `conversation:${encodeURIComponent(chat)}${message === undefined ? '' : `:${encodeURIComponent(message)}`}`
}
