import type { TabState } from '@/store/editor'

/**
 * What a tab says when you hover it.
 *
 * A tab is capped at 180px and its label is `truncate`d, so anything longer
 * than about twenty characters is shown as a prefix and an ellipsis — which is
 * exactly the case where the name matters: `census_tracts_2020_clipped.R` and
 * `census_tracts_2020_clean.R` are the same tab to look at. The ellipsis takes
 * the dirty marker with it too, so a long name hides the one thing telling the
 * user the file has unsaved changes.
 *
 * The second line is the answer to "which one is this", and it differs by what
 * the tab holds: a file has a path (two files of the same name in different
 * directories is the ordinary case), and an object-backed tab has the R
 * expression that reaches it — `myenv$roads` is not `roads`, and the tab label
 * cannot say so.
 *
 * Pure and separate from the component so it can be tested with no DOM, and so
 * the tab strip and the data viewer's own header cannot drift apart.
 */
export function tabTooltip(tab: TabState): string {
  const lines: string[] = [tab.fileName]

  if (tab.type === 'code') {
    lines.push(tab.filePath ?? 'Not saved to disk')
  } else {
    const kind = tab.type === 'function-editor' ? 'Function editor' : 'Data viewer'
    const reach = tab.accessPath ?? tab.objectName ?? tab.fileName
    // The environment is worth a word only when it is not the one every
    // unqualified name already resolves in.
    const where = tab.envName && tab.envName !== '.GlobalEnv' ? ` in ${tab.envName}` : ''
    lines.push(`${kind} · ${reach}${where}`)
  }

  if (tab.isDirty) lines.push('Unsaved changes')
  return lines.join('\n')
}
