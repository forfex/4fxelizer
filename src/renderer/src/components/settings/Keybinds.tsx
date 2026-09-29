// Settings › Keyboard: every menu command with its shortcut. Click a shortcut, then press the new
// keys; Backspace/Delete removes it, Escape cancels. A shortcut taken from another command is
// removed there (and said so).

import { useMemo, useState } from 'react'
import type { MenuCommand } from '@shared/api'
import { acceleratorFromKey, acceleratorOf, assignKeybind, bindableCommands, reservedBy } from '@shared/keybinds'
import { formatAccelerator } from '@shared/menu'
import { cn } from '@/lib/utils'
import { saveSettings, useSavedSettings } from '@/settings'
import { Button } from '../ui/button'
import { Led } from '../ui/retro'

const platform = window.fx.platform
const COMMANDS = bindableCommands(platform)
const LABELS = new Map(COMMANDS.map((c) => [c.command, c.label]))

/** Elements marked with this take every key press (the title bar leaves Alt and F10 to them). */
export const CAPTURE_KEYS_ATTR = 'data-capture-keys'

interface Notice {
  text: string
  tone: 'info' | 'error'
}

export function KeybindsEditor({
  query,
  recording,
  onRecordingChange
}: {
  /** Search text: only matching commands are listed. */
  query: string
  recording: MenuCommand | null
  onRecordingChange(command: MenuCommand | null): void
}) {
  const { keybinds } = useSavedSettings()
  const [notice, setNotice] = useState<Notice | null>(null)
  const q = query.trim().toLowerCase()

  const groups = useMemo(() => {
    const byGroup = new Map<string, typeof COMMANDS>()
    for (const c of COMMANDS) {
      const accelerator = acceleratorOf(c.command, keybinds, platform)
      const text = `${c.group} ${c.label} ${accelerator ? formatAccelerator(accelerator, platform) : ''}`.toLowerCase()
      if (q && !text.includes(q)) continue
      byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c])
    }
    return [...byGroup]
  }, [keybinds, q])

  const assign = (command: MenuCommand, accelerator: string): void => {
    const result = assignKeybind(keybinds, command, accelerator, platform)
    saveSettings({ keybinds: result.keybinds })
    const keys = accelerator ? formatAccelerator(accelerator, platform) : ''
    if (result.unbound.length) {
      const from = result.unbound.map((c) => LABELS.get(c)).join(', ')
      setNotice({ text: `${keys} moved to ${LABELS.get(command)}; ${from} has no shortcut now.`, tone: 'info' })
    } else setNotice(null)
  }

  const onKeyDown = (command: MenuCommand, e: React.KeyboardEvent): void => {
    if (recording !== command) return
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
    // Plain Tab leaves the field (and ends recording on blur).
    if (plain && e.key === 'Tab') return
    e.preventDefault()
    e.stopPropagation()
    if (plain && e.key === 'Escape') {
      onRecordingChange(null)
      return
    }
    if (plain && (e.key === 'Backspace' || e.key === 'Delete')) {
      assign(command, '')
      onRecordingChange(null)
      return
    }
    const result = acceleratorFromKey(e.nativeEvent, platform)
    if (!result) return
    if ('error' in result) {
      setNotice({ text: result.error, tone: 'error' })
      return
    }
    const taken = reservedBy(result.accelerator, platform)
    if (taken) {
      setNotice({ text: `${formatAccelerator(result.accelerator, platform)} is kept for ${taken}.`, tone: 'error' })
      return
    }
    assign(command, result.accelerator)
    onRecordingChange(null)
  }

  const changed = Object.keys(keybinds).length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-dim">
          Click a shortcut and press the new keys. <kbd className="font-mono text-small">Backspace</kbd> removes it,{' '}
          <kbd className="font-mono text-small">Esc</kbd> cancels.
        </p>
        <Button
          disabled={!changed}
          onClick={() => {
            saveSettings({ keybinds: {} })
            setNotice({ text: 'All shortcuts are back to their defaults.', tone: 'info' })
          }}
        >
          Reset all shortcuts
        </Button>
      </div>
      {notice && (
        <p role="status" className="flex items-center gap-1.5">
          <Led state={notice.tone === 'error' ? 'error' : 'warn'} />
          {notice.text}
        </p>
      )}
      {groups.length === 0 && <p className="text-dim">No commands match “{query.trim()}”.</p>}
      {groups.map(([group, commands]) => (
        <div key={group} className="flex flex-col">
          <h4 className="pb-1 text-dim label-caps">{group}</h4>
          {commands.map((c) => {
            const accelerator = acceleratorOf(c.command, keybinds, platform)
            const isChanged = keybinds[c.command] !== undefined
            const isRecording = recording === c.command
            return (
              <div key={c.command} className="flex min-h-8 items-center gap-2 border-b-px border-line last:border-b-0">
                <span className="min-w-0 flex-1 truncate">
                  {c.label}
                  {isChanged && <span className="ml-1.5 text-small text-dim">(changed)</span>}
                </span>
                <button
                  type="button"
                  {...{ [CAPTURE_KEYS_ATTR]: isRecording ? '' : undefined }}
                  aria-label={`Shortcut for ${c.label}`}
                  title={isRecording ? 'Press the new shortcut' : 'Click to change'}
                  onClick={() => {
                    setNotice(null)
                    onRecordingChange(isRecording ? null : c.command)
                  }}
                  onKeyDown={(e) => onKeyDown(c.command, e)}
                  onBlur={() => isRecording && onRecordingChange(null)}
                  className={cn(
                    'bevel-sunken flex h-control w-40 shrink-0 items-center justify-center rounded-fx border-px border-edge bg-well px-2',
                    'font-mono text-small text-text focus-visible:ring-focus',
                    isRecording && 'bg-accent-soft ring-focus',
                    !accelerator && !isRecording && 'text-faint'
                  )}
                >
                  {isRecording ? 'Press keys…' : accelerator ? formatAccelerator(accelerator, platform) : 'None'}
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={cn(!isChanged && 'invisible')}
                  title={`Back to the default (${c.defaultAccelerator ? formatAccelerator(c.defaultAccelerator, platform) : 'none'})`}
                  onClick={() => assign(c.command, c.defaultAccelerator)}
                >
                  Reset
                </Button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
