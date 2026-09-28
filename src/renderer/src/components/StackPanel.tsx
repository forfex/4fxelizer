import { useMemo, useRef, useState } from 'react'
import { STAGE_TYPES, stageLabel } from '@/gpu/passes'
import type { StageSpec } from '@/gpu/plan'
import { cn } from '@/lib/utils'
import { analyzeStack, type StageInfo } from '@/stack/analyze'
import { useApp } from '@/store'
import { BlendRow, PaletteSelect, StageEditor } from './stages/editors'
import { Button } from './ui/button'
import { Checkbox } from './ui/controls'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from './ui/menu'
import { GroupBox, Led, LedToggle, PanelBody } from './ui/retro'

export function StackPanel() {
  const image = useApp((s) => s.image)
  const stages = useApp((s) => s.stages)
  const palettes = useApp((s) => s.palettes)
  const outputLock = useApp((s) => s.outputLock)
  const previewUid = useApp((s) => s.previewUid)
  const maps = useApp((s) => s.maps)
  const info = useMemo(
    () => analyzeStack(image, stages, palettes, outputLock, new Set(Object.keys(maps))),
    [image, stages, palettes, outputLock, maps]
  )
  const reorder = useReorder(stages)
  const finalSize = stages.length ? info.get(stages[stages.length - 1]!.uid)?.output : image

  return (
    <PanelBody>
      <GroupBox title="Source">
        {image ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-dim">File</dt>
            <dd className="truncate" title={image.name}>{image.name}</dd>
            <dt className="text-dim">Size</dt>
            <dd className="font-mono">{image.width} × {image.height}</dd>
          </dl>
        ) : (
          <p className="text-dim">No image loaded.</p>
        )}
      </GroupBox>

      <GroupBox title="Stack">
        <div ref={reorder.listRef} className="flex flex-col gap-1.5">
          {stages.map((stage, i) => (
            <div key={stage.uid} data-uid={stage.uid} className="flex flex-col gap-1.5">
              {reorder.dropBefore === stage.uid && <DropLine />}
              <StageCard
                stage={stage}
                index={i}
                count={stages.length}
                info={info.get(stage.uid)}
                previewing={previewUid === stage.uid}
                dragging={reorder.draggingUid === stage.uid}
                onGripPointerDown={(e) => reorder.start(e, stage.uid)}
              />
            </div>
          ))}
          {reorder.dropBefore === END && <DropLine />}
          {stages.length === 0 && <p className="text-dim">The stack is empty: the output is the source.</p>}
        </div>
        <div className="mt-2 flex">
          <AddStageMenu />
        </div>
      </GroupBox>

      <GroupBox title="Output">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => useApp.getState().setPreview(null)}
            className={cn(
              'bevel-raised flex h-7 items-center gap-2 rounded-fx bg-panel-hi px-2 text-left',
              previewUid === null && 'outline-px outline-accent'
            )}
            title="Show the final result in the viewer"
          >
            <Led state={previewUid === null ? 'on' : 'off'} />
            <span className="font-semibold">Final result</span>
            {finalSize && image && (
              <span className="ml-auto font-mono text-small text-dim">
                {finalSize.width}×{finalSize.height}
              </span>
            )}
          </button>
          <Checkbox
            checked={outputLock.enabled}
            onCheckedChange={(enabled) => useApp.getState().edit((d) => ({ outputLock: { ...d.outputLock, enabled } }))}
            label="Lock output to palette"
            hint="Snap the final result to a palette, so blending or later stages can't add colors outside it. Use it for indexed/PSX export."
          />
          {outputLock.enabled && (
            <PaletteSelect
              value={outputLock.paletteId}
              onChange={(paletteId) => useApp.getState().edit((d) => ({ outputLock: { ...d.outputLock, paletteId } }))}
            />
          )}
        </div>
      </GroupBox>
    </PanelBody>
  )
}

const END = '__end'

function DropLine() {
  return <div className="-my-1 h-0.5 rounded-full bg-accent" />
}

/** Pointer-driven reordering: drag a card by its grip, drop between cards. */
function useReorder(stages: StageSpec[]) {
  const listRef = useRef<HTMLDivElement>(null)
  const [draggingUid, setDraggingUid] = useState<string | null>(null)
  const [dropBefore, setDropBefore] = useState<string | null>(null)

  const targetFor = (clientY: number, uid: string): { before: string; index: number } => {
    const others = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-uid]') ?? [])].filter(
      (el) => el.dataset.uid !== uid
    )
    const index = others.filter((el) => {
      const r = el.getBoundingClientRect()
      return r.top + r.height / 2 < clientY
    }).length
    return { before: others[index]?.dataset.uid ?? END, index }
  }

  const start = (e: React.PointerEvent<HTMLElement>, uid: string): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const grip = e.currentTarget
    grip.setPointerCapture(e.pointerId)
    setDraggingUid(uid)
    const from = stages.findIndex((s) => s.uid === uid)
    let last = targetFor(e.clientY, uid)

    const move = (ev: PointerEvent): void => {
      last = targetFor(ev.clientY, uid)
      // Dropping where the card already is would be a no-op; don't show a line there.
      setDropBefore(last.index === from ? null : last.before)
    }
    const end = (ev: PointerEvent): void => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', end)
      grip.removeEventListener('pointercancel', end)
      setDraggingUid(null)
      setDropBefore(null)
      if (ev.type === 'pointerup' && last.index !== from) useApp.getState().moveStage(uid, last.index)
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', end)
    grip.addEventListener('pointercancel', end)
  }

  return { listRef, draggingUid, dropBefore, start }
}

function StageCard({
  stage,
  index,
  count,
  info,
  previewing,
  dragging,
  onGripPointerDown
}: {
  stage: StageSpec
  index: number
  count: number
  info: StageInfo | undefined
  previewing: boolean
  dragging: boolean
  onGripPointerDown(e: React.PointerEvent<HTMLElement>): void
}) {
  const [open, setOpen] = useState(true)
  const [blendOpen, setBlendOpen] = useState(false)
  const { updateStage, setPreview, duplicateStage, removeStage, moveStage } = useApp.getState()
  const warnings = info?.warnings ?? []
  const resized = info && (info.input.width !== info.output.width || info.input.height !== info.output.height)
  const blended = stage.blend.opacity < 1 || stage.blend.mode !== 'normal'

  return (
    <div
      className={cn(
        'bevel-raised flex flex-col rounded-fx bg-panel-hi',
        previewing && 'outline-px outline-accent',
        dragging && 'opacity-50'
      )}
    >
      <div className="flex h-7 items-center gap-1.5 pr-1 pl-0.5">
        <span
          className="flex h-full w-3.5 shrink-0 cursor-grab touch-none items-center justify-center text-dim active:cursor-grabbing"
          title="Drag to reorder"
          onPointerDown={onGripPointerDown}
          aria-hidden
        >
          ⋮⋮
        </span>
        <LedToggle
          label="Enabled"
          checked={stage.enabled}
          onCheckedChange={(enabled) => updateStage(stage.uid, { enabled })}
        />
        <button
          type="button"
          className={cn('min-w-0 flex-1 truncate text-left font-semibold', !stage.enabled && 'text-dim line-through')}
          title={previewing ? 'Showing the image after this stage. Click to show the final result.' : 'Show the image after this stage'}
          onClick={() => setPreview(previewing ? null : stage.uid)}
        >
          {stageLabel(stage.passId)}
          {blended && <span className="pl-1 font-normal text-dim">· {Math.round(stage.blend.opacity * 100)}%</span>}
        </button>
        {resized && (
          <span className="font-mono text-small text-dim" title="Output size">
            {info.output.width}×{info.output.height}
          </span>
        )}
        {warnings.length > 0 && (
          <span title={warnings.join('\n')}>
            <Led state="warn" />
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-5"
          title={previewing ? 'Previewing this stage' : 'Preview the image at this stage'}
          aria-pressed={previewing}
          onClick={() => setPreview(previewing ? null : stage.uid)}
        >
          ◉
        </Button>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-5" title="Stage actions">
              ⋯
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onSelect={() => duplicateStage(stage.uid)}>Duplicate</MenuItem>
            <MenuItem disabled={index === 0} onSelect={() => moveStage(stage.uid, index - 1)}>Move up</MenuItem>
            <MenuItem disabled={index === count - 1} onSelect={() => moveStage(stage.uid, index + 1)}>Move down</MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => removeStage(stage.uid)}>Delete</MenuItem>
          </MenuContent>
        </Menu>
        <Button
          variant="ghost"
          size="icon"
          className="size-5"
          title={open ? 'Collapse' : 'Expand'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? '▾' : '▸'}
        </Button>
      </div>
      {open && (
        <div className={cn('flex flex-col gap-1.5 border-t-px border-bevel-dark px-2 pt-2 pb-2', !stage.enabled && 'opacity-60')}>
          {warnings.map((w) => (
            <p key={w} className="flex gap-1.5 text-small text-led-warn">
              <Led state="warn" className="mt-1" />
              {w}
            </p>
          ))}
          <StageEditor stage={stage} info={info} />
          <button
            type="button"
            className="mt-0.5 flex items-center gap-1 self-start text-small text-dim hover:text-text"
            onClick={() => setBlendOpen(!blendOpen)}
            aria-expanded={blendOpen}
          >
            {blendOpen ? '▾' : '▸'} Blending{blended ? ` (${stage.blend.mode}, ${Math.round(stage.blend.opacity * 100)}%)` : ''}
          </button>
          {blendOpen && <BlendRow stage={stage} />}
        </div>
      )}
    </div>
  )
}

function AddStageMenu() {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button className="flex-1" title="Add a stage (after the previewed stage, or at the end)">
          + Add stage
        </Button>
      </MenuTrigger>
      <MenuContent className="w-72">
        {STAGE_TYPES.map((t) => (
          <MenuItem
            key={t.passId}
            className="h-auto flex-col items-start gap-0 py-1"
            onSelect={() => {
              // Insert after the previewed stage when there is one, otherwise at the end.
              const { addStage, previewUid, stages } = useApp.getState()
              const at = previewUid ? stages.findIndex((s) => s.uid === previewUid) + 1 : 0
              addStage(t.passId, at > 0 ? at : undefined)
            }}
          >
            <span className="font-semibold">{t.label}</span>
            <span className="text-small opacity-80">{t.hint}</span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}
