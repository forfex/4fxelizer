// Edit › Settings: preferences in categories (a sidebar), each category a few sections. "All"
// lists every section; the search box filters sections (and shortcuts) across all of them.

import { useEffect, useState, type ReactNode } from 'react'
import type { MenuCommand } from '@shared/api'
import { bindableCommands } from '@shared/keybinds'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'
import { INPUT_CLASS } from '../ui/controls'
import { Dialog, DialogContent } from '../ui/dialog'
import { MENU_MARK_CLASS } from '../ui/menu'
import { KeybindsEditor } from './Keybinds'
import { AppearanceSection, GpuSection, InterfaceSection, ResetSection, ViewerSection, WheelSection } from './sections'

type CategoryId = 'all' | 'general' | 'appearance' | 'mouse' | 'viewer' | 'keybinds' | 'gpu'

const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'mouse', label: 'Mouse' },
  { id: 'viewer', label: 'Viewer' },
  { id: 'keybinds', label: 'Keybinds' },
  { id: 'gpu', label: 'GPU' }
]

interface SectionProps {
  query: string
  recording: MenuCommand | null
  onRecordingChange(command: MenuCommand | null): void
}

interface Section {
  id: string
  category: Exclude<CategoryId, 'all'>
  title: string
  /** Extra words the search finds this section by. */
  keywords: string
  render(props: SectionProps): ReactNode
}

const COMMAND_WORDS = bindableCommands(window.fx.platform)
  .map((c) => `${c.group} ${c.label}`)
  .join(' ')

const SECTIONS: Section[] = [
  { id: 'interface', category: 'general', title: 'Interface', keywords: 'scale zoom size ui dpi bigger smaller', render: () => <InterfaceSection /> },
  { id: 'reset', category: 'general', title: 'Settings file', keywords: 'reset defaults restore folder json', render: () => <ResetSection /> },
  { id: 'theme', category: 'appearance', title: 'Theme', keywords: 'color colour dark light night matrix retro look', render: () => <AppearanceSection /> },
  {
    id: 'wheel',
    category: 'mouse',
    title: 'Mouse wheel on sliders and dropdowns',
    keywords: 'scroll hover arm delay slider dropdown select wheel speed',
    render: () => <WheelSection />
  },
  { id: 'viewer', category: 'viewer', title: 'Viewer and 3D view', keywords: 'zoom invert wheel grid split tiling 3d', render: () => <ViewerSection /> },
  {
    id: 'keybinds',
    category: 'keybinds',
    title: 'Keyboard shortcuts',
    keywords: `keybinds hotkeys keys accelerator ${COMMAND_WORDS}`,
    render: (p) => <KeybindsEditor query={p.query} recording={p.recording} onRecordingChange={p.onRecordingChange} />
  },
  { id: 'gpu', category: 'gpu', title: 'Graphics card', keywords: 'gpu adapter webgpu discrete integrated power performance restart diagnostics', render: () => <GpuSection /> }
]

function matches(section: Section, query: string): boolean {
  const q = query.trim().toLowerCase()
  return !q || `${section.title} ${section.keywords}`.toLowerCase().includes(q)
}

/** Remembered while the app runs, so Settings reopens where it was left. */
let lastCategory: CategoryId = 'all'

export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen)
  const setOpen = useApp((s) => s.setSettingsOpen)
  const [category, setCategory] = useState<CategoryId>(lastCategory)
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<MenuCommand | null>(null)

  // While a shortcut is recorded, the keys pressed must not also run the commands they're bound to.
  useEffect(() => {
    if (!recording) return
    window.fx.suspendShortcuts(true)
    return () => window.fx.suspendShortcuts(false)
  }, [recording])

  const choose = (id: CategoryId): void => {
    lastCategory = id
    setCategory(id)
    setQuery('')
  }
  const searching = query.trim() !== ''
  const shown = SECTIONS.filter((s) => (searching ? matches(s, query) : category === 'all' || s.category === category))
  // The search only narrows the shortcut list when it isn't about the section itself.
  const sectionQuery = (s: Section): string => (searching && !s.title.toLowerCase().includes(query.trim().toLowerCase()) ? query : '')

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setRecording(null)
        setOpen(o)
      }}
    >
      <DialogContent
        title="Settings"
        className="h-[min(640px,85vh)] w-[min(900px,92vw)]"
        bodyClassName="flex p-0 overflow-hidden"
        // Escape while recording a shortcut cancels the recording, not the dialog.
        onEscapeKeyDown={(e) => recording && e.preventDefault()}
      >
        <nav aria-label="Settings categories" className="flex w-44 shrink-0 flex-col gap-2 border-r-px border-edge bg-panel-hi p-2">
          <input
            type="search"
            className={INPUT_CLASS}
            placeholder="Search settings"
            aria-label="Search settings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-0.5">
            {CATEGORIES.map((c) => {
              const selected = !searching && c.id === category
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => choose(c.id)}
                  className={cn(
                    'relative flex h-7 items-center rounded-[2px] pr-2 pl-5.5 text-left text-text outline-none',
                    'hover:bg-hover focus-visible:ring-focus',
                    selected && 'bg-accent-soft font-medium'
                  )}
                >
                  {selected && <span className={MENU_MARK_CLASS} />}
                  {c.label}
                </button>
              )
            })}
          </div>
        </nav>
        <div role="tabpanel" className="@container/panel flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto bg-panel p-4">
          {shown.length === 0 && <p className="text-dim">No settings match “{query.trim()}”.</p>}
          {shown.map((s, i) => {
            const heading = CATEGORIES.find((c) => c.id === s.category)!.label
            // In the full list, each category starts with its name.
            const showCategory = (category === 'all' || searching) && shown[i - 1]?.category !== s.category
            return (
              <section key={s.id} aria-labelledby={`settings-${s.id}`} className="flex flex-col gap-2.5">
                {showCategory && <h2 className="font-display text-[15px] font-bold tracking-[0.02em]">{heading}</h2>}
                <h3 id={`settings-${s.id}`} className="border-b-px border-line pb-1 text-dim label-caps">
                  {s.title}
                </h3>
                {s.render({ query: sectionQuery(s), recording, onRecordingChange: setRecording })}
              </section>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
