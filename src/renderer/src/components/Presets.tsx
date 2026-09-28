import { useEffect, useState } from 'react'
import type { PresetEntry } from '@shared/api'
import {
  BUILTIN_PRESETS,
  deleteUserPreset,
  exportPresetFile,
  importPresetFile,
  loadBuiltinPreset,
  loadUserPreset,
  saveUserPreset
} from '@/actions'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'
import { Button } from './ui/button'
import { Dialog, DialogContent } from './ui/dialog'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './ui/menu'

/** The user's saved presets; reloads whenever one is saved or deleted. */
function useUserPresets(): PresetEntry[] | null {
  const version = useApp((s) => s.presetsVersion)
  const [presets, setPresets] = useState<PresetEntry[] | null>(null)
  useEffect(() => {
    let live = true
    window.fx.listPresets().then(
      (list) => live && setPresets(list),
      () => live && setPresets([])
    )
    return () => {
      live = false
    }
  }, [version])
  return presets
}

/** Toolbar dropdown: quick load of built-in and saved presets, plus save/import/export. */
export function PresetsMenu() {
  const [open, setOpen] = useState(false)
  const presets = useUserPresets()
  const { setPresetsOpen, presetsChanged } = useApp.getState()
  return (
    <Menu
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) presetsChanged() // pick up files added outside the app
      }}
    >
      <MenuTrigger asChild>
        <Button title="Save the current stack as a preset, or apply one">Presets ▾</Button>
      </MenuTrigger>
      <MenuContent className="w-64">
        <MenuItem onSelect={() => setPresetsOpen(true)}>Save current as preset…</MenuItem>
        <MenuSeparator />
        <MenuLabel>My presets</MenuLabel>
        {presets?.length ? (
          presets.map((p) => (
            <MenuItem key={p.file} onSelect={() => loadUserPreset(p.file)}>
              <span className="truncate">{p.name}</span>
            </MenuItem>
          ))
        ) : (
          <MenuItem disabled>{presets ? 'None saved yet' : 'Loading…'}</MenuItem>
        )}
        <MenuSeparator />
        <MenuLabel>Built-in</MenuLabel>
        {BUILTIN_PRESETS.map((p) => (
          <MenuItem key={p.name} title={p.hint} onSelect={() => loadBuiltinPreset(p)}>
            {p.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={importPresetFile}>Import preset file…</MenuItem>
        <MenuItem onSelect={exportPresetFile}>Export current as file…</MenuItem>
        <MenuItem onSelect={() => setPresetsOpen(true)}>Manage presets…</MenuItem>
      </MenuContent>
    </Menu>
  )
}

/** Save the current stack under a name; load, delete, import and export presets. */
export function PresetsDialog() {
  const open = useApp((s) => s.presetsOpen)
  const setOpen = useApp((s) => s.setPresetsOpen)
  const presetName = useApp((s) => s.presetName)
  const imageName = useApp((s) => s.image?.name)
  const presets = useUserPresets()
  const [name, setName] = useState('')
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(presetName ?? (imageName ? `${imageName.replace(/\.[^.]+$/, '')} look` : 'My preset'))
    setConfirmOverwrite(false)
    setConfirmDelete(null)
    useApp.getState().presetsChanged()
  }, [open]) // only when the dialog opens

  const save = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) return
    const saved = await saveUserPreset(trimmed, confirmOverwrite)
    if (saved) setOpen(false)
    else setConfirmOverwrite(true)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Presets" className="w-[min(480px,90vw)]">
        <div className="flex flex-col gap-3">
          <p className="text-small text-dim">
            A preset stores the whole stack (stages, settings, blending) and its palettes. Palettes generated from
            the image are rebuilt for each texture you apply the preset to.
          </p>
          <div className="flex flex-col gap-1">
            <span className="text-small font-semibold tracking-wide text-dim uppercase">Save current stack as</span>
            <div className="flex gap-1.5">
              <input
                className="bevel-sunken h-7 min-w-0 flex-1 rounded-fx bg-well px-2 outline-none"
                value={name}
                aria-label="Preset name"
                autoFocus
                onChange={(e) => {
                  setName(e.target.value)
                  setConfirmOverwrite(false)
                }}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
              <Button variant="primary" onClick={save} disabled={!name.trim()}>
                {confirmOverwrite ? 'Overwrite' : 'Save'}
              </Button>
            </div>
            {confirmOverwrite && (
              <p className="text-small text-led-warn">A preset with this name exists. Press Overwrite to replace it.</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-small font-semibold tracking-wide text-dim uppercase">My presets</span>
            <div className="bevel-sunken flex max-h-64 flex-col overflow-y-auto bg-well p-0.5">
              {presets?.length ? (
                presets.map((p) => (
                  <div key={p.file} className="flex h-7 items-center gap-1.5 rounded-fx px-1.5 hover:bg-panel-hi">
                    <span className="min-w-0 flex-1 truncate" title={p.file}>
                      {p.name}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => {
                        loadUserPreset(p.file)
                        setOpen(false)
                      }}
                    >
                      Load
                    </Button>
                    <Button
                      size="sm"
                      className={cn(confirmDelete === p.file && 'text-led-error')}
                      title="Delete this preset file"
                      onClick={() => {
                        if (confirmDelete === p.file) {
                          deleteUserPreset(p.file)
                          setConfirmDelete(null)
                        } else setConfirmDelete(p.file)
                      }}
                    >
                      {confirmDelete === p.file ? 'Really delete?' : 'Delete'}
                    </Button>
                  </div>
                ))
              ) : (
                <p className="px-1.5 py-1 text-dim">{presets ? 'No saved presets yet.' : 'Loading…'}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-1.5">
            <Button size="sm" onClick={() => window.fx.showPresetsFolder()} title="Open the folder where presets are stored">
              Open folder
            </Button>
            <Button size="sm" onClick={importPresetFile}>Import file…</Button>
            <Button size="sm" onClick={exportPresetFile}>Export current…</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
