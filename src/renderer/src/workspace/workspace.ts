// Dockable panel layout ("workspace"), like Photoshop's: panels can be docked on any side, tabbed
// together, floated over the viewer and resized. Built-in workspaces are built through the
// dockview API (not stored JSON), so they keep working when dockview's format changes. The current
// layout and the user's saved workspaces live in user settings.

import type { DockviewApi, SerializedDockview } from 'dockview-react'
import { MAX_WORKSPACES, type SavedWorkspace } from '@shared/api'
import { savedSettings, saveSettings } from '@/settings'
import { useApp } from '@/store'
import { layoutProblem } from './layoutCheck'

export const VIEWER = 'viewer'

export interface PanelDef {
  id: string
  title: string
  /** Narrowest the panel may get when docked. */
  minWidth: number
}

/** Tool panels (the viewer is always there and can't be closed). */
export const PANELS: PanelDef[] = [
  { id: 'stack', title: 'Stack', minWidth: 240 },
  { id: 'palettes', title: 'Palettes', minWidth: 220 },
  { id: 'generate', title: 'Generate', minWidth: 220 }
]

interface BuiltinWorkspace {
  id: string
  name: string
  hint: string
  build(api: DockviewApi): void
}

const panelDef = (id: string): PanelDef => PANELS.find((p) => p.id === id)!

/** Components a stored layout may use (they match the components registered in Workspace.tsx). */
const KNOWN = { components: [VIEWER, ...PANELS.map((p) => p.id)], tabComponents: [VIEWER], required: VIEWER }

/** Restores a stored layout, after checking it only uses panels this version has. */
function restore(dock: DockviewApi, layout: unknown): void {
  const problem = layoutProblem(layout, KNOWN)
  if (problem) throw new Error(problem)
  dock.fromJSON(layout as SerializedDockview)
}

/** Adds the viewer, unless it is still there (kept so switching workspaces doesn't remount it). */
function addViewer(api: DockviewApi): void {
  if (api.getPanel(VIEWER)) return
  api.addPanel({ id: VIEWER, component: VIEWER, tabComponent: VIEWER, title: viewerTitle(), renderer: 'always' })
}

/** Adds a tool panel next to (or, with 'within', tabbed into) `reference`; null = at that edge of the dock. */
function addTool(
  api: DockviewApi,
  id: string,
  reference: string | null,
  direction: 'left' | 'right' | 'above' | 'below' | 'within',
  size?: number
): void {
  const def = panelDef(id)
  api.addPanel({
    id,
    component: id,
    title: def.title,
    minimumWidth: def.minWidth,
    position: reference ? { referencePanel: reference, direction } : { direction: direction === 'within' ? 'right' : direction },
    ...(size && (direction === 'left' || direction === 'right' ? { initialWidth: size } : { initialHeight: size })),
    inactive: direction === 'within'
  })
}

export const BUILTIN_WORKSPACES: BuiltinWorkspace[] = [
  {
    id: 'essentials',
    name: 'Essentials',
    hint: 'Stack on the left, palettes and generator on the right.',
    build(api) {
      addViewer(api)
      addTool(api, 'stack', VIEWER, 'left', 320)
      addTool(api, 'palettes', VIEWER, 'right', 300)
      addTool(api, 'generate', 'palettes', 'below', 330)
    }
  },
  {
    id: 'wide-viewer',
    name: 'Wide viewer',
    hint: 'Every panel in one right-hand column, for the most image space.',
    build(api) {
      addViewer(api)
      addTool(api, 'stack', VIEWER, 'right', 330)
      addTool(api, 'palettes', 'stack', 'below')
      addTool(api, 'generate', 'palettes', 'within')
    }
  },
  {
    id: 'palette-focus',
    name: 'Palette editing',
    hint: 'A wide palette panel, with the stack and generator tabbed on the left.',
    build(api) {
      addViewer(api)
      addTool(api, 'stack', VIEWER, 'left', 300)
      addTool(api, 'generate', 'stack', 'within')
      addTool(api, 'palettes', VIEWER, 'right', 400)
    }
  },
  {
    id: 'floating',
    name: 'Floating',
    hint: 'Panels float over the viewer; drag them anywhere, or onto an edge to dock.',
    build(api) {
      addViewer(api)
      const { width } = api
      const float = (id: string, x: number, y: number, w: number, h: number): void => {
        api.addPanel({ id, component: id, title: panelDef(id).title, floating: { x, y, width: w, height: h } })
      }
      float('stack', 12, 12, 320, 560)
      float('palettes', Math.max(width - 312, 344), 12, 300, 330)
      float('generate', Math.max(width - 312, 344), 356, 300, 330)
    }
  }
]

let api: DockviewApi | null = null

function viewerTitle(): string {
  return useApp.getState().image?.name ?? 'Viewer'
}

/** Keeps whichever group holds the viewer from taking other panels as tabs (also after the viewer moves). */
function lockViewerGroup(dock: DockviewApi): void {
  for (const group of dock.groups) {
    const locked = group.panels.some((p) => p.id === VIEWER)
    if (!!group.locked !== locked) group.locked = locked
  }
}

/** After any layout is built or loaded. */
function finishLayout(dock: DockviewApi): void {
  dock.getPanel(VIEWER)?.api.setTitle(viewerTitle())
  lockViewerGroup(dock)
}

/** Removes every panel but a docked viewer (a floating viewer goes too, so templates start clean). */
function clearTools(dock: DockviewApi): void {
  if (dock.hasMaximizedGroup()) dock.exitMaximizedGroup()
  const viewer = dock.getPanel(VIEWER)
  if (!viewer || viewer.api.location.type !== 'grid') {
    if (dock.panels.length) dock.clear()
    return
  }
  for (const panel of [...dock.panels]) if (panel.id !== VIEWER) dock.removePanel(panel)
}

/** Builds a layout: a built-in workspace, or a saved one. Returns false when it couldn't. */
function applyLayout(dock: DockviewApi, workspace: string): boolean {
  const builtin = BUILTIN_WORKSPACES.find((w) => w.id === workspace)
  const saved = savedSettings().workspaces.find((w) => w.name === workspace)
  try {
    if (builtin) {
      clearTools(dock)
      builtin.build(dock)
    } else if (saved) restore(dock, saved.layout)
    else return false
    if (!dock.getPanel(VIEWER)) throw new Error('layout has no viewer')
    finishLayout(dock)
    return true
  } catch (e) {
    console.warn(`Workspace "${workspace}" could not be loaded:`, e)
    return false
  }
}

function buildDefault(dock: DockviewApi): void {
  clearTools(dock)
  BUILTIN_WORKSPACES[0]!.build(dock)
  finishLayout(dock)
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

/** Called once the dock view exists: restores the last layout and keeps it saved. */
export function startWorkspace(dock: DockviewApi): () => void {
  api = dock
  const settings = savedSettings()
  let restored = false
  if (settings.layout) {
    try {
      restore(dock, settings.layout)
      restored = !!dock.getPanel(VIEWER)
      if (restored) finishLayout(dock)
    } catch (e) {
      console.warn('Saved panel layout could not be restored:', e)
    }
  }
  if (!restored && !applyLayout(dock, settings.workspace)) {
    buildDefault(dock)
    saveSettings({ workspace: BUILTIN_WORKSPACES[0]!.id })
  }

  const save = (): void => {
    clearTimeout(saveTimer)
    saveTimer = undefined
    saveSettings({ layout: dock.toJSON() })
  }
  const layoutSub = dock.onDidLayoutChange(() => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(save, 400)
  })
  const moveSub = dock.onDidMovePanel(() => lockViewerGroup(dock))
  // Quitting right after a change: save it now rather than dropping it.
  const flush = (): void => {
    if (saveTimer !== undefined) save()
  }
  window.addEventListener('beforeunload', flush)
  // The viewer's tab shows the image's file name.
  const unsubscribe = useApp.subscribe((s, prev) => {
    if (s.image !== prev.image) dock.getPanel(VIEWER)?.api.setTitle(viewerTitle())
  })
  return () => {
    layoutSub.dispose()
    moveSub.dispose()
    window.removeEventListener('beforeunload', flush)
    unsubscribe()
    clearTimeout(saveTimer)
    if (api === dock) api = null
  }
}

/** Switches to a workspace (built-in id or saved name), rebuilt from its template. */
export function selectWorkspace(workspace: string): void {
  if (!api) return
  if (!applyLayout(api, workspace)) {
    useApp.getState().setMessage({ kind: 'error', text: `Workspace "${workspace}" could not be loaded.` })
    buildDefault(api)
    workspace = BUILTIN_WORKSPACES[0]!.id
  }
  saveSettings({ workspace, layout: api.toJSON() })
}

/** Puts the active workspace back the way its template has it. */
export function resetWorkspace(): void {
  selectWorkspace(savedSettings().workspace)
}

export function workspaceName(workspace: string): string {
  return BUILTIN_WORKSPACES.find((w) => w.id === workspace)?.name ?? workspace
}

/** The user's saved workspaces, minus any that a built-in one would shadow (a hand-edited settings file). */
export function savedWorkspaces(): SavedWorkspace[] {
  return savedSettings().workspaces.filter((w) => !isReservedName(w.name))
}

/** Names that would shadow a built-in workspace (compared without case). */
export function isReservedName(name: string): boolean {
  const n = name.trim().toLowerCase()
  return BUILTIN_WORKSPACES.some((w) => w.id === n || w.name.toLowerCase() === n)
}

/** Saves the current layout as a named workspace (replacing one with the same name) and makes it active. */
export function saveWorkspaceAs(name: string): boolean {
  const trimmed = name.trim()
  if (!api || !trimmed || isReservedName(trimmed)) return false
  const entry: SavedWorkspace = { name: trimmed, layout: api.toJSON() }
  const workspaces = [...savedSettings().workspaces.filter((w) => w.name !== trimmed), entry].slice(-MAX_WORKSPACES)
  saveSettings({ workspaces, workspace: trimmed })
  useApp.getState().setMessage({ kind: 'info', text: `Saved workspace "${trimmed}"` })
  return true
}

export function deleteWorkspace(name: string): void {
  const settings = savedSettings()
  saveSettings({
    workspaces: settings.workspaces.filter((w) => w.name !== name),
    ...(settings.workspace === name ? { workspace: BUILTIN_WORKSPACES[0]!.id } : {})
  })
}

export function isPanelOpen(id: string): boolean {
  return !!api?.getPanel(id)
}

/** Shows a closed tool panel (docked to the right of the viewer) or closes an open one. */
export function togglePanel(id: string): void {
  if (!api) return
  const panel = api.getPanel(id)
  if (panel) {
    panel.api.close()
    return
  }
  // Tab it into another docked tool panel's group when there is one, else dock it at the right edge.
  const neighbor = PANELS.map((p) => api!.getPanel(p.id)).find(
    (p) => p && p.api.location.type === 'grid' && !p.group.panels.some((q) => q.id === VIEWER)
  )
  if (neighbor) addTool(api, id, neighbor.id, 'within')
  else addTool(api, id, null, 'right', 300)
  api.getPanel(id)?.api.setActive()
}
