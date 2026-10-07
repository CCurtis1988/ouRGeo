export function redactContext(text: string): string {
  return text
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, '[redacted credential]')
    .replace(/\b(authorization\s*[:=]\s*)(?:Bearer\s+)?[^\r\n,]+/gi, '$1[redacted]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*)["']?[^\s,"'\r\n]+["']?/gi, '$1[redacted]')
}

/** Stable revisions are observations, never evidence of unchanged R values. */
export function contentRevision(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16)
}
