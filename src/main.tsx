import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

// Skill-training harness only (OURGEO_EVAL=1). A normal launch never loads it.
if (window.electronAPI?.evalMode) void import('./lib/eval/bridge').then(m => m.installEvalBridge())

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
