import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { collectGpuReport } from './gpu/report'
import { installPixelSnap } from './lib/pixelSnap'
import { getEngine } from './engine'
import { useApp } from './store'
import './styles/index.css'

installPixelSnap()

// Dev builds expose the store for debugging from DevTools / automation (window.__fx.useApp.getState()).
if (import.meta.env.DEV) Object.assign(window, { __fx: { useApp, getEngine } })
const root = createRoot(document.getElementById('root')!)

if (new URLSearchParams(location.search).get('mode') === 'gpu-report') {
  // Headless diagnostics run (`--gpu-report`): collect, hand to main, which writes and quits.
  root.render(<p>Collecting GPU report…</p>)
  collectGpuReport().then((report) => window.fx.submitGpuReport(report))
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
