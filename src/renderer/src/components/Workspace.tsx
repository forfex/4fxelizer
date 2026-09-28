import { useEffect, useState } from 'react'
import {
  DockviewDefaultTab,
  DockviewReact,
  type DockviewApi,
  type DockviewTheme,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps
} from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import '@/styles/dock.css'
import { savedSettings, saveSettings, useSavedSettings } from '@/settings'
import {
  BUILTIN_WORKSPACES,
  deleteWorkspace,
  isPanelOpen,
  isReservedName,
  PANELS,
  resetWorkspace,
  savedWorkspaces,
  saveWorkspaceAs,
  selectWorkspace,
  startWorkspace,
  togglePanel,
  VIEWER,
  workspaceName
} from '@/workspace/workspace'
import { GeneratePanel, PalettePanel } from './PalettePanel'
import { StackPanel } from './StackPanel'
import { Button } from './ui/button'
import { Dialog, DialogClose, DialogContent } from './ui/dialog'
import { ErrorBoundary } from './ErrorBoundary'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from './ui/menu'
import { Viewer } from './Viewer'

/** dockview theme whose CSS variables map onto our --fx-* tokens (styles/dock.css). */
const THEME: DockviewTheme = {
  name: '4fx',
  className: 'dockview-theme-fx',
  colorScheme: 'dark',
  // dockview takes the gap as a number, so it is read from the token once.
  gap: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fx-dock-gap')) || 4,
  dndOverlayMounting: 'absolute',
  dndPanelOverlay: 'group'
}

const COMPONENTS: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  [VIEWER]: () => (
    <div className="flex h-full min-h-0 bg-panel p-1.5">
      <Viewer />
    </div>
  ),
  stack: StackPanel,
  palettes: PalettePanel,
  generate: GeneratePanel
}

const TAB_COMPONENTS: Record<string, React.FunctionComponent<IDockviewPanelHeaderProps>> = {
  // The viewer can't be closed, and its tab shows the file name as written.
  [VIEWER]: (props) => (
    <span className="flex h-full normal-case">
      <DockviewDefaultTab {...props} hideClose />
    </span>
  )
}

/** The dock, falling back to a notice with a layout reset if a panel fails to render. */
export function DockArea() {
  return (
    <ErrorBoundary
      fallback={(error, retry) => (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-panel p-4 text-center">
          <p>The panel layout could not be shown.</p>
          <p className="text-small text-dim">{error}</p>
          <Button
            onClick={() => {
              saveSettings({ layout: null, workspace: BUILTIN_WORKSPACES[0]!.id })
              retry()
            }}
          >
            Reset panel layout
          </Button>
        </div>
      )}
    >
      <Dock />
    </ErrorBoundary>
  )
}

/** The dockable panel area: viewer plus tool panels, arranged by the active workspace. */
function Dock() {
  // The layout is built from an effect, not from onReady itself: under StrictMode (dev) the dock
  // mounts twice, and only the instance that survives may be filled.
  const [api, setApi] = useState<DockviewApi | null>(null)
  useEffect(() => (api ? startWorkspace(api) : undefined), [api])
  return (
    <DockviewReact
      className="min-h-0 flex-1"
      theme={THEME}
      components={COMPONENTS}
      tabComponents={TAB_COMPONENTS}
      onReady={(e) => setApi(e.api)}
      floatingGroupBounds="boundedWithinViewport"
      getTabContextMenuItems={({ panel }) =>
        panel.id === VIEWER ? ['maximize'] : ['float', 'maximize', 'separator', 'close']
      }
    />
  )
}

/** Toolbar dropdown: switch, save, reset and delete workspaces; show or hide panels. */
export function WorkspaceMenu() {
  const [saveOpen, setSaveOpen] = useState(false)
  const { workspace } = useSavedSettings()
  const workspaces = savedWorkspaces()
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button title="Panel layout: switch, save or reset workspaces, show or hide panels">
            {workspaceName(workspace)} ▾
          </Button>
        </MenuTrigger>
        <MenuContent align="end" className="w-64">
          <MenuLabel>Workspaces</MenuLabel>
          {BUILTIN_WORKSPACES.map((w) => (
            <MenuItem key={w.id} title={w.hint} onSelect={() => selectWorkspace(w.id)}>
              <Check on={workspace === w.id} />
              {w.name}
            </MenuItem>
          ))}
          {workspaces.map((w) => (
            <MenuItem key={w.name} onSelect={() => selectWorkspace(w.name)}>
              <Check on={workspace === w.name} />
              <span className="truncate">{w.name}</span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onSelect={resetWorkspace}>Reset {workspaceName(workspace)}</MenuItem>
          <MenuItem onSelect={() => setSaveOpen(true)}>Save workspace as…</MenuItem>
          <MenuSub>
            <MenuSubTrigger disabled={!workspaces.length}>Delete workspace</MenuSubTrigger>
            <MenuSubContent>
              {workspaces.map((w) => (
                <MenuItem key={w.name} onSelect={() => deleteWorkspace(w.name)}>
                  <span className="truncate">{w.name}</span>
                </MenuItem>
              ))}
            </MenuSubContent>
          </MenuSub>
          <MenuSeparator />
          <MenuLabel>Panels</MenuLabel>
          {PANELS.map((p) => (
            <MenuItem key={p.id} onSelect={() => togglePanel(p.id)}>
              <Check on={isPanelOpen(p.id)} />
              {p.title}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      <SaveWorkspaceDialog open={saveOpen} onOpenChange={setSaveOpen} />
    </>
  )
}

function Check({ on }: { on: boolean }) {
  return <span className="w-4 shrink-0 text-accent">{on ? '✓' : ''}</span>
}

function SaveWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const [name, setName] = useState('')
  useEffect(() => {
    if (open) {
      const current = savedSettings().workspace
      setName(savedSettings().workspaces.some((w) => w.name === current) ? current : '')
    }
  }, [open])
  const trimmed = name.trim()
  const reserved = isReservedName(trimmed)
  const replaces = savedSettings().workspaces.some((w) => w.name === trimmed)
  const save = (): void => {
    if (saveWorkspaceAs(trimmed)) onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Save workspace" className="w-[min(380px,90vw)]">
        <div className="flex flex-col gap-2.5">
          <p className="text-small text-dim">Saves where every panel is docked or floating, and its size.</p>
          <input
            autoFocus
            className="bevel-sunken h-6 w-full rounded-fx bg-well px-1.5 outline-none"
            placeholder="Workspace name"
            aria-label="Workspace name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && trimmed && !reserved && save()}
          />
          {reserved && <p className="text-small text-led-warn">That name belongs to a built-in workspace.</p>}
          {replaces && !reserved && <p className="text-small text-dim">Replaces the saved workspace "{trimmed}".</p>}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={!trimmed || reserved} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
