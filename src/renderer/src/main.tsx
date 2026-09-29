import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { collectGpuReport } from './gpu/report'
import { installPixelSnap } from './lib/pixelSnap'
import { startSettingsSync } from './settings'
import { startThemeSync } from './theme'
import { startLiveReload } from './liveReload'
import { startProjectGuard } from './projectActions'
import { openDroppedFiles } from './actions'
import { getEngine } from './engine'
import { useApp } from './store'
import './styles/fonts.css'
import './styles/index.css'

installPixelSnap()

// Dev builds expose the store for debugging from DevTools / automation (window.__fx.useApp.getState()),
// and opening dropped files (window.__fx.openDroppedFiles([{ name, bytes, path }])).
if (import.meta.env.DEV) Object.assign(window, { __fx: { useApp, getEngine, openDroppedFiles } })
const root = createRoot(document.getElementById('root')!)

if (new URLSearchParams(location.search).get('mode') === 'gpu-report') {
  // Headless diagnostics run (`--gpu-report`): collect, hand to main, which writes and quits.
  root.render(<p>Collecting GPU report…</p>)
  collectGpuReport().then((report) => window.fx.submitGpuReport(report))
} else {
  startSettingsSync()
  startThemeSync()
  startLiveReload()
  startProjectGuard()
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
