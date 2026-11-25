import { useMemo, useRef, useState } from 'react'
import { openImage } from '@/actions'
import { STAGE_TYPES, stageLabel } from '@/gpu/passes'
import type { StageSpec } from '@/gpu/plan'
import { cn } from '@/lib/utils'
import { analyzeStack, blendMaskOf, type StageInfo } from '@/stack/analyze'
import { stageSummary } from '@/stack/summary'
import { useApp } from '@/store'
import { revealPanel } from '@/workspace/workspace'
import { BlendRow, Fold, PaletteSelect, StageEditor } from './stages/editors'
import { Button } from './ui/button'
import { Checkbox, Field } from './ui/controls'
import { CaretIcon, MoreIcon, PlusIcon, PreviewIcon } from './ui/icons'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from './ui/menu'
import { GroupBox, Led, LedToggle, PanelBody } from './ui/retro'

/**
 * Which stack the active texture is processed with (shown once several textures are open, or it
 * has its own). Read-only: it reveals the Textures panel, where the stack is switched.
 */
function StackBadge() {
  const id = useApp((s) => s.activeTextureId)
  const separate = useApp((s) => !!id && !!s.docs.separate[id])
  const sharedCount = useApp((s) => s.textures.filter((t) => !s.docs.separate[t.id]).length)
  const count = useApp((s) => s.textures.length)
  const name = useApp((s) => s.image?.name ?? '')
  if (!id || (count < 2 && !separate)) return null
  const text = separate ? `Only ${name}` : `Shared · ${sharedCount} ${sharedCount === 1 ? 'texture' : 'textures'}`
  return (
    <Field label="Stack">
      <button
        type="button"
        className="bevel-raised flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-fx border-px border-edge bg-panel-hi px-2 text-left text-small hover:text-accent-hi"
        title={
          separate
            ? 'This texture has a stack of its own. Switch it in the Textures panel.'
            : 'These textures share this stack and are processed the same way. Give one its own stack in the Textures panel.'
        }
        onClick={() => revealPanel('textures')}
      >
        <span className="min-w-0 flex-1 truncate">{text}</span>
        <span className="shrink-0 text-dim">Textures…</span>
      </button>
    </Field>
  )
}

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
          <div className="flex flex-col gap-2">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt className="text-dim">File</dt>
              <dd className="truncate" title={image.name}>{image.name}</dd>
              <dt className="text-dim">Size</dt>
              <dd className="font-mono">{image.width} × {image.height}</dd>
            </dl>
            <StackBadge />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 text-dim">Open a texture to start.</span>
            <Button size="sm" variant="primary" onClick={openImage}>
              Open…
            </Button>
          </div>
        )}
      </GroupBox>

      <GroupBox title="Stack" data-tour="stack">
        <div ref={reorder.listRef} className="flex flex-col gap-1.5">
          {stages.map((stage, i) => (
            <div key={stage.uid} data-uid={stage.uid} data-tour={`stage-${stage.passId}`} className="flex flex-col gap-1.5">
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

/** The click that opens a stage card without closing the others. */
const MULTI_CLICK = window.fx.platform === 'darwin' ? '⌘-click' : 'Ctrl+click'

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
  const open = useApp((s) => s.openStages.includes(stage.uid))
  const summary = useApp((s) => (open ? '' : stageSummary(stage, s.palettes)))
  const [blendOpen, setBlendOpen] = useState(false)
  const { updateStage, setPreview, duplicateStage, removeStage, moveStage, setStageOpen } = useApp.getState()
  // Opening a card closes the others; Ctrl/Cmd-click keeps them open.
  const toggle = (e: React.MouseEvent): void => setStageOpen(stage.uid, !open, e.ctrlKey || e.metaKey)
  const warnings = info?.warnings ?? []
  const resized = info && (info.input.width !== info.output.width || info.input.height !== info.output.height)
  const blended = stage.blend.opacity < 1 || stage.blend.mode !== 'normal'
  const masked = !!blendMaskOf(stage)
  const blendSummary = [blended && stage.blend.mode, blended && `${Math.round(stage.blend.opacity * 100)}%`, masked && 'masked'].filter(Boolean).join(', ')

  return (
    <div
      className={cn(
        // A size container: the header drops its size readout when the card is narrow.
        '@container/card flex flex-col rounded-fx-md border-px border-edge',
        previewing
          ? 'bg-accent-soft shadow-[inset_var(--px)_var(--px)_0_var(--fx-bevel-light),inset_3px_0_0_var(--fx-accent)]'
          : 'bg-panel-hi bevel-raised',
        dragging && 'opacity-50'
      )}
    >
      <div
        className="flex h-8 min-w-0 cursor-default items-center gap-1 pr-1 pl-1 select-none"
        title={`${open ? 'Click to collapse' : 'Click to open'} · ${MULTI_CLICK} keeps other stages open`}
        // A click on the header (not on one of its controls or the grip) opens or closes the card.
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, [role="switch"], [role="checkbox"], input, [data-grip]')) return
          toggle(e)
        }}
      >
        <span
          data-grip
          className="flex h-full w-3 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          title="Drag to reorder"
          onPointerDown={onGripPointerDown}
          aria-hidden
        >
          {/* Grip: a 50% dither of faint dots. */}
          <span className="h-3.5 w-1.5 dither-50 [--dither-a:var(--fx-text-faint)] [--dither-b:transparent]" />
        </span>
        <LedToggle
          label="Enabled"
          checked={stage.enabled}
          onCheckedChange={(enabled) => updateStage(stage.uid, { enabled })}
        />
        {/* Only the preview button previews: a stray click on the name must not change the view. */}
        {/* The name stays whole; the summary after it gives way when the card is narrow. */}
        <span className="flex min-w-0 flex-1 items-baseline">
          <span
            className={cn(
              'max-w-full shrink-0 truncate font-display text-[14px] leading-[18px] font-semibold',
              !stage.enabled && 'text-faint line-through'
            )}
          >
            {stageLabel(stage.passId)}
          </span>
          {(blended || masked) && (
            <span className="shrink-0 pl-1 text-small text-dim">· {blended ? `${Math.round(stage.blend.opacity * 100)}%` : 'masked'}</span>
          )}
          {summary && (
            <span className="min-w-0 truncate pl-1.5 text-small text-dim" title={summary}>
              {summary}
            </span>
          )}
        </span>
        {resized && (
          <span className="hidden shrink-0 font-mono text-[10px] text-dim @min-[280px]/card:inline" title="Output size">
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
          className={cn('size-5 shrink-0', !previewing && 'hidden @min-[200px]/card:inline-flex')}
          title={previewing ? 'Showing the image after this stage. Click to show the final result.' : 'Show the image after this stage'}
          aria-label="Preview this stage"
          aria-pressed={previewing}
          onClick={() => setPreview(previewing ? null : stage.uid)}
        >
          <PreviewIcon className={previewing ? 'text-accent-hi' : 'text-dim'} />
        </Button>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-5 shrink-0" title="Stage actions" aria-label="Stage actions">
              <MoreIcon className="text-dim" />
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
          className="size-5 shrink-0"
          title={`${open ? 'Collapse' : 'Open'} (${MULTI_CLICK} keeps other stages open)`}
          aria-label={open ? 'Collapse' : 'Open'}
          aria-expanded={open}
          onClick={toggle}
        >
          <CaretIcon open={open} className="text-dim" />
        </Button>
      </div>
      {open && (
        <div
          className={cn('@container/panel flex min-w-0 flex-col gap-2 border-t-px border-edge px-2 pt-2 pb-2', !stage.enabled && 'opacity-60')}
        >
          {warnings.map((w) => (
            <p key={w} className="flex gap-1.5 text-small text-led-warn">
              <Led state="warn" className="mt-1" />
              {w}
            </p>
          ))}
          <StageEditor stage={stage} info={info} />
          <Fold label="Blending" summary={blendSummary} open={blendOpen} onOpenChange={setBlendOpen}>
            <BlendRow stage={stage} />
          </Fold>
        </div>
      )}
    </div>
  )
}

function AddStageMenu() {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button data-tour="add-stage" className="flex-1" title="Add a stage (after the previewed stage, or at the end)">
          <PlusIcon /> Add stage
        </Button>
      </MenuTrigger>
      <MenuContent className="w-72">
        {STAGE_TYPES.map((t) => (
          <MenuItem
            key={t.passId}
            className="h-auto flex-col items-start gap-0 py-1.5 whitespace-normal"
            onSelect={() => {
              // Insert after the previewed stage when there is one, otherwise at the end.
              const { addStage, previewUid, stages } = useApp.getState()
              const at = previewUid ? stages.findIndex((s) => s.uid === previewUid) + 1 : 0
              addStage(t.passId, at > 0 ? at : undefined)
            }}
          >
            <span className="font-display font-semibold">{t.label}</span>
            <span className="text-small text-dim">{t.hint}</span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}
