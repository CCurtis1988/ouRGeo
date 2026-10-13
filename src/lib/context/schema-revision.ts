import { contentRevision } from './policy'

/** Cached column hydration is discovery metadata, not an R mutation. A late
 * inventory event can replace that cache while an authoritative schema read is
 * pending. Bind observations to execution/runtime/scope, shape and disclosure;
 * never reject a valid current read merely because the UI learned its columns. */
export function schemaRevision(generation: string, object: { class: string; dim?: number[] | null }, excluded: readonly string[]): string {
  return contentRevision(JSON.stringify({ generation, class: object.class, dim: object.dim, excluded }))
}
