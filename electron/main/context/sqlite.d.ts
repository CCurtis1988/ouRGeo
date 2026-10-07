declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean })
    exec(sql: string): void
    prepare(sql: string): { run(...args: unknown[]): unknown; all(...args: unknown[]): Record<string, unknown>[]; get(...args: unknown[]): Record<string, unknown> | undefined }
    close(): void
  }
}
