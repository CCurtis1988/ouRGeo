import type { CompletionCandidate } from './types'

/** R reserved words / control-flow keywords offered in identifier position. */
export const R_KEYWORDS = [
  'if',
  'else',
  'for',
  'while',
  'repeat',
  'function',
  'return',
  'break',
  'next',
  'in',
  'TRUE',
  'FALSE',
  'NULL',
  'NA',
  'NA_integer_',
  'NA_real_',
  'NA_character_',
  'Inf',
  'NaN',
] as const

/**
 * dplyr / tidyr data-masking verbs: inside these calls a bare identifier refers
 * to a column of the piped-in (or `data=`/first-arg) frame, so we complete
 * column names rather than objects.
 */
export const MASKING_VERBS = new Set([
  'filter',
  'mutate',
  'transmute',
  'summarise',
  'summarize',
  'arrange',
  'group_by',
  'ungroup',
  'select',
  'rename',
  'distinct',
  'count',
  'add_count',
  'tally',
  'slice',
  'slice_min',
  'slice_max',
  'slice_head',
  'slice_tail',
  'slice_sample',
  'pull',
  'relocate',
  'reframe',
  'across',
  'if_else',
  'case_when',
  // tidyr
  'pivot_longer',
  'pivot_wider',
  'separate',
  'unite',
  'nest',
  'unnest',
  'fill',
  'drop_na',
  'replace_na',
  // base data-masking
  'subset',
  'with',
  'within',
  'transform',
])

/** ggplot2 aesthetic mappers: bare identifiers here are columns of the plot data. */
export const AES_VERBS = new Set(['aes', 'aes_string'])

/**
 * Functions whose (first) argument is a package name — offer installed-package
 * completion there, quoted or bare. `library(dplyr)` / `require("sf")` etc.
 */
export const PACKAGE_ARG_FNS = new Set([
  'library',
  'require',
  'requireNamespace',
  'loadNamespace',
  'attachNamespace',
  'suppressPackageStartupMessages',
  'install.packages',
  'remove.packages',
  'packageVersion',
  'packageDescription',
  'citation',
])

/**
 * Package-loading functions that take *several* package names across positional
 * arguments (pacman) — offer package completion in any argument, not just the first.
 */
export const PACKAGE_MULTIARG_FNS = new Set(['p_load', 'p_install', 'p_load_gh'])

/**
 * Snippet library. `prefix` is matched in identifier position; `body` uses `$0`
 * to mark the final caret. Kept small and idiomatic — library boilerplate and
 * common spatial / tidyverse pipelines.
 */
export interface SnippetDef {
  prefix: string
  label: string
  detail: string
  body: string
}

export const SNIPPETS: SnippetDef[] = [
  {
    prefix: 'lib',
    label: 'library',
    detail: 'library(pkg)',
    body: 'library($0)',
  },
  {
    prefix: 'ggplot',
    label: 'ggplot + geom',
    detail: 'ggplot(data, aes()) + geom_*()',
    body: 'ggplot($1, aes($2)) +\n  geom_$0()',
  },
  {
    prefix: 'stread',
    label: 'st_read',
    detail: 'read a vector layer with sf',
    body: 'st_read("$0")',
  },
  {
    prefix: 'pipe',
    label: 'dplyr pipeline',
    detail: 'data |> verb()',
    body: '$1 |>\n  filter($0)',
  },
  {
    prefix: 'mutate',
    label: 'mutate()',
    detail: 'add / change columns',
    body: 'mutate($0)',
  },
  {
    prefix: 'forloop',
    label: 'for loop',
    detail: 'for (i in seq)',
    body: 'for ($1 in $2) {\n  $0\n}',
  },
  {
    prefix: 'fun',
    label: 'function',
    detail: 'function definition',
    body: '$1 <- function($2) {\n  $0\n}',
  },
  {
    prefix: 'ifelse',
    label: 'if / else',
    detail: 'if (cond) {} else {}',
    body: 'if ($1) {\n  $2\n} else {\n  $0\n}',
  },
  {
    prefix: 'tmap',
    label: 'tmap map',
    detail: 'tm_shape() + tm_polygons()',
    body: 'tm_shape($1) +\n  tm_polygons($0)',
  },
]

/** Build snippet candidates (caret marker `$N` is resolved by the host). */
export function snippetCandidates(): CompletionCandidate[] {
  return SNIPPETS.map((s) => ({
    id: `snippet:${s.prefix}`,
    label: s.prefix,
    insertText: s.body,
    kind: 'snippet' as const,
    detail: s.detail,
    rType: s.label,
    bias: 5, // snippets rank just below exact object/function matches
  }))
}

export function keywordCandidates(): CompletionCandidate[] {
  return R_KEYWORDS.map((k) => ({
    id: `kw:${k}`,
    label: k,
    insertText: k,
    kind: 'keyword' as const,
    bias: 8,
  }))
}
