// The open textures as tabs in the viewer panel's header: click to work on one, × or middle-click
// to close it, + to open more. A dot marks a texture with a separate stack.

import type { ReactNode } from 'react'
import { closeTexture, openImage } from '@/actions'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'
import { PlusIcon } from './ui/icons'
import { CloseIcon } from './ui/retro'

export function TextureTabs({ fallback }: { fallback: ReactNode }) {
  const textures = useApp((s) => s.textures)
  const active = useApp((s) => s.activeTextureId)
  const separate = useApp((s) => s.docs.separate)
  const model = useApp((s) => s.model)
  if (!textures.length) return fallback
  return (
    <div
      role="tablist"
      aria-label="Textures"
      className="fx-texture-tabs flex h-full min-w-0 flex-1 items-end gap-(--fx-space-1) overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
      // Tabs are buttons, not a handle to drag the viewer panel by (dockview drags its tab on mousedown).
      onMouseDown={(e) => e.preventDefault()}
      onWheel={(e) => {
        e.currentTarget.scrollLeft += e.deltaY
      }}
    >
      {textures.map((t) => {
        const selected = t.id === active
        const materials = t.materials.map((m) => model?.materials[m]?.name).filter(Boolean)
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            title={[t.image.path ?? t.image.name, `${t.image.width} × ${t.image.height}`, separate[t.id] ? 'Separate stack' : 'Shared stack', ...(materials.length ? [`Material: ${materials.join(', ')}`] : [])].join('\n')}
            onClick={() => useApp.getState().selectTexture(t.id)}
            onAuxClick={(e) => {
              if (e.button === 1) closeTexture(t.id)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') useApp.getState().selectTexture(t.id)
              if (e.key === 'Delete') closeTexture(t.id)
            }}
            className={cn(
              'group/tab flex h-[calc(var(--fx-dock-tab-height)-3px)] max-w-52 min-w-0 shrink-0 cursor-default items-center gap-2 rounded-t-fx-md border-px border-b-0 pr-1.5 pl-3 text-small',
              selected
                ? 'relative z-1 border-edge bg-panel text-text shadow-[inset_0_calc(2*var(--px))_0_var(--fx-accent),inset_var(--px)_0_0_var(--fx-bevel-light)]'
                : 'border-transparent text-dim hover:text-text'
            )}
          >
            {separate[t.id] && <span className="size-1.5 shrink-0 rounded-[1px] bg-magenta" title="Separate stack" />}
            <span className="min-w-0 truncate">{t.image.name}</span>
            {materials.length > 0 && <span className="shrink-0 text-faint">· {materials.join(', ')}</span>}
            <button
              type="button"
              aria-label={`Close ${t.image.name}`}
              title="Close (middle-click the tab)"
              className={cn('flex size-4 shrink-0 items-center justify-center rounded-[2px] hover:bg-hover', !selected && 'opacity-0 group-hover/tab:opacity-100')}
              onClick={(e) => {
                e.stopPropagation()
                closeTexture(t.id)
              }}
            >
              <CloseIcon className="size-3" />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        aria-label="Open textures"
        title="Open textures (several at once)"
        onClick={() => void openImage()}
        className="mb-0.5 flex size-5 shrink-0 items-center justify-center self-center rounded-fx text-dim hover:bg-hover hover:text-text"
      >
        <PlusIcon />
      </button>
    </div>
  )
}
