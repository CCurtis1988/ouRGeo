import type React from 'react'
import type { ColumnInfo, RFormalArg, REnvironmentInfo } from '@/lib/r-client'

/**
 * Which analyzer the engine uses. Defaulted to 'r' at every call site so the
 * console and R tabs cannot accidentally opt in to markdown completions.
 */
export type CompletionMode = 'r' | 'markdown' | 'rmarkdown'

/** Broad category of a completion, used for grouping, ranking and icon choice. */
export type CompletionKind =
  | 'object' // an environment variable / data object
  | 'column' // a data.frame / sf column
  | 'function' // a function (package or user-defined)
  | 'argument' // a function parameter name
  | 'package' // a package name (library() / :: context)
  | 'snippet' // a code snippet
  | 'keyword' // an R language keyword
  | 'markdown' // a markdown element from the `/` slash menu

/** A lucide icon component, as the markdown catalog stores them. */
export type CandidateIcon = React.ComponentType<{ className?: string; size?: number | string }>

export interface CompletionCandidate {
  /** stable id (kind + name) for React keys */
  id: string
  /** primary text shown in the row and matched against the typed prefix */
  label: string
  /** text inserted, replacing the range [from, to] on the source buffer */
  insertText: string
  kind: CompletionKind
  /** R class/type string — drives the glyph and is shown on the right */
  rType?: string
  /** secondary muted text (signature, package, default value) */
  detail?: string
  /**
   * Caret position after insert, as an offset from the END of insertText.
   * e.g. a function inserted as `name()` uses -1 to land between the parens.
   */
  cursorOffset?: number
  /** intrinsic priority within a match tier (lower sorts first) */
  bias?: number
  /**
   * A drawn icon, used instead of the kind's typographic glyph.
   *
   * The markdown catalog already carries one lucide icon per action for the
   * ribbon; passing it through means a `/` row and its ribbon button show the
   * same picture, and the twenty markdown entries stop being twenty identical
   * pilcrows. `iconTint` groups them by colour.
   */
  icon?: CandidateIcon
  iconTint?: string
  /** populated by the matcher: score + which chars matched (for highlight) */
  score?: number
  matched?: number[]
}

/** A completion request result: the replace range plus ranked candidates. */
export interface CompletionResult {
  /** offset in the source text where the replaced token begins */
  from: number
  /** offset where the replaced token ends (the cursor) */
  to: number
  candidates: CompletionCandidate[]
  /**
   * Ask the controller to open the popup even with no typed prefix. Set by the
   * markdown slash context so `/` alone shows the menu, WITHOUT widening the
   * shared `structural` character test (adding `/` there would pop the menu on
   * `a/b` in the R console).
   */
  autoOpen?: boolean
  /**
   * Data the engine needed but did not have cached. The controller should
   * fetch these, populate its caches, then re-run the query.
   */
  wants: {
    columns: { name: string; envName: string }[]
    formals: string[]
  }
}

/** Everything the engine reads. Async data is supplied via cached getters. */
export interface EngineDeps {
  index: EnvIndex
  /** cached columns for an object (store-known or lazily fetched), or undefined */
  getColumns: (objName: string, envName: string) => ColumnInfo[] | undefined
  /** cached formals for a function, or undefined */
  getFormals: (fnName: string) => RFormalArg[] | undefined
  /** all installed packages (across every library), for library()/require() completion */
  getPackages: () => IndexedPackage[]
}

/** An installed package, offered inside library()/require()/:: contexts. */
export interface IndexedPackage {
  name: string
  version?: string
  loaded: boolean
}

/** Flat, prebuilt index of the R session derived from the environment store. */
export interface EnvIndex {
  /** source array identity — used to memoize index construction */
  source: REnvironmentInfo[]
  /** user objects across non-search-path environments */
  objects: IndexedObject[]
  /** callable names (package exports + user functions) */
  functions: IndexedFunction[]
  /** loaded package names (without the "package:" prefix) */
  packages: string[]
  /** name -> object, for quick receiver/frame lookup */
  byName: Map<string, IndexedObject>
}

export interface IndexedObject {
  name: string
  rClass: string
  envName: string
  columns?: ColumnInfo[]
  isDataFrame: boolean
  isList: boolean
}

export interface IndexedFunction {
  name: string
  /** package the function came from (undefined = user/global) */
  pkg?: string
}
