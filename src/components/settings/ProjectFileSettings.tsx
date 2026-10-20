import React, { useEffect } from 'react'
import { Switch } from '../ui/switch'
import { loadProjectFilePreferences, useProjectFileReplaceStore } from '@/store/project-file-replace'

/** Settings → Project Files: the way back from "Don't ask again". */
export function ProjectFileSettings(): React.ReactElement {
  const ask = useProjectFileReplaceStore(s => s.askBeforeReplacing)
  const setAsk = useProjectFileReplaceStore(s => s.setAskBeforeReplacing)
  useEffect(() => { void loadProjectFilePreferences() }, [])
  return (
    <Switch
      checked={ask}
      onChange={setAsk}
      data-ourgeo-id="settings.projectFilesAskReplace"
      label="Ask before an export replaces a project file"
      description={<>
        Export dialogs — plots, map images, map code, tables and vector layers — save into Project Files by
        name, so exporting <span className="font-mono">sites.csv</span> again replaces the file already there.
        When on, ouRGeo asks first. R code such as <span className="font-mono">ourgeo_project_path()</span> always
        replaces without asking, as writing over a file on disk does.
      </>}
    />
  )
}
