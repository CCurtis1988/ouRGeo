import React from 'react'

/** Settings → Project Files. The replace-file question moved to Settings →
 *  Prompts, the one home for every silenceable prompt; this page says where. */
export function ProjectFileSettings({ onOpenPrompts }: { onOpenPrompts?: () => void }): React.ReactElement {
  return (
    <p className="text-xs text-geo-muted leading-relaxed">
      Export dialogs — plots, map images, map code, tables and vector layers — save into Project Files by name, so
      exporting <span className="font-mono">sites.csv</span> again replaces the file already there. Whether ouRGeo asks
      first is set in{' '}
      <button type="button" className="text-geo-accent hover:underline" onClick={onOpenPrompts}>Settings → Prompts</button>.
      R code such as <span className="font-mono">ourgeo_project_path()</span> always replaces without asking, as writing
      over a file on disk does.
    </p>
  )
}
