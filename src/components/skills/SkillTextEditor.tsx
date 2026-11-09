import React, { useEffect, useRef } from 'react'
import MonacoEditor, { loader, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { EDITOR_MONACO_THEME } from '@/lib/editor-themes'

// The SKILL.md editor in the Skill Manager: the same bundled Monaco as the code
// editor, never a CDN copy (`loader.config` is idempotent; CodeEditor sets it too).
// The theme is the one shared `EDITOR_MONACO_THEME`, which CodeEditor keeps in
// step with the app, code and markdown themes, so this editor follows them with
// no theme logic of its own. Markdown, so ```r fences are highlighted as R.
loader.config({ monaco })

export interface SkillTextEditorProps {
  value: string
  onChange: (value: string) => void
  readOnly: boolean
  ariaLabel: string
  /** Ctrl/Cmd+S while the editor has focus. */
  onSave?: () => void
}

export function SkillTextEditor({ value, onChange, readOnly, ariaLabel, onSave }: SkillTextEditorProps): React.ReactElement {
  // Monaco keeps the command it was given at mount; read the latest handler at call time.
  const saveRef = useRef(onSave)
  useEffect(() => { saveRef.current = onSave }, [onSave])

  const mount: OnMount = (editor, m) => {
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => saveRef.current?.())
  }

  return (
    <div className="h-72 border border-geo-border rounded overflow-hidden" data-testid="skill-text-editor">
      <MonacoEditor
        value={value}
        language="markdown"
        theme={EDITOR_MONACO_THEME}
        onChange={next => onChange(next ?? '')}
        onMount={mount}
        options={{
          readOnly, ariaLabel, domReadOnly: readOnly,
          minimap: { enabled: false }, wordWrap: 'on', lineNumbers: 'on', fontSize: 12,
          scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2, renderLineHighlight: 'none',
          unicodeHighlight: { ambiguousCharacters: false },
        }}
      />
    </div>
  )
}
