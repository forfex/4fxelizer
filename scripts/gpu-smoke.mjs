// CI smoke test: launch the built app (out/) in `--gpu-report` mode and check that it starts and reports.
//
//   node scripts/gpu-smoke.mjs [report.json] [--require-webgpu] [-- extra electron args]
//
// Fails if the app doesn't start or doesn't write a report within the timeout. A missing WebGPU
// adapter (common on GPU-less CI runners) is only a warning unless --require-webgpu is passed.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const TIMEOUT_MS = 120_000

const args = process.argv.slice(2)
const sep = args.indexOf('--')
const own = sep === -1 ? args : args.slice(0, sep)
const extra = sep === -1 ? [] : args.slice(sep + 1)
const requireWebgpu = own.includes('--require-webgpu')
const reportPath = resolve(own.find((a) => !a.startsWith('--')) ?? '4fxelizer-gpu-report.json')

const electron = createRequire(import.meta.url)('electron')
rmSync(reportPath, { force: true })

const child = spawn(electron, ['.', `--gpu-report=${reportPath}`, ...extra], { stdio: 'inherit' })
const timer = setTimeout(() => {
  console.error(`::error::App did not finish within ${TIMEOUT_MS / 1000}s`)
  child.kill()
}, TIMEOUT_MS)

child.on('exit', (code) => {
  clearTimeout(timer)
  if (!existsSync(reportPath)) {
    console.error(`::error::App exited (code ${code}) without writing a GPU report`)
    process.exit(1)
  }
  const { renderer } = JSON.parse(readFileSync(reportPath, 'utf8'))
  const adapter = renderer.adapter ? `${renderer.adapter.vendor} ${renderer.adapter.description}`.trim() : 'none'
  const ok = renderer.webgpu && renderer.smokeTest?.ok
  const summary = `WebGPU: ${renderer.webgpu}, adapter: ${adapter || 'unknown'}, smoke test: ${
    renderer.smokeTest ? `${renderer.smokeTest.ok} (${renderer.smokeTest.detail})` : 'not run'
  }${renderer.error ? `, error: ${renderer.error}` : ''}`
  console.log(`\nApp started and reported. ${summary}`)
  if (ok) process.exit(0)
  console.log(`::${requireWebgpu ? 'error' : 'warning'}::WebGPU check failed on ${process.platform}: ${summary}`)
  process.exit(requireWebgpu ? 1 : 0)
})
