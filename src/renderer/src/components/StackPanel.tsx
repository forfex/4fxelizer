import type { PosterizeParams } from '@/gpu/passes/posterize'
import { useApp } from '@/store'
import { Slider } from './ui/slider'
import { GroupBox, Lcd, LedToggle } from './ui/retro'

export function StackPanel() {
  const image = useApp((s) => s.image)
  const stages = useApp((s) => s.stages)
  const updateStage = useApp((s) => s.updateStage)

  return (
    <aside className="bevel-raised flex w-72 shrink-0 flex-col gap-3 overflow-y-auto bg-panel p-3">
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
        <div className="flex flex-col gap-2">
          {stages.map((stage) => {
            const params = stage.params as PosterizeParams
            return (
              <div key={stage.uid} className="bevel-raised flex flex-col gap-2 rounded-fx bg-panel-hi p-2">
                <div className="flex items-center gap-2">
                  <LedToggle
                    label="Enabled"
                    checked={stage.enabled}
                    onCheckedChange={(enabled) => updateStage(stage.uid, { enabled })}
                  />
                  <span className="font-semibold">Posterize</span>
                  <span className="ml-auto rounded-fx border-px border-dim/40 px-1 text-small text-dim">TEST</span>
                </div>
                <label className="flex items-center gap-2">
                  <span className="w-12 text-dim">Levels</span>
                  <Slider
                    className="flex-1"
                    min={2}
                    max={16}
                    step={1}
                    ticks={15}
                    value={[params.levels]}
                    disabled={!stage.enabled}
                    onValueChange={([levels]) => updateStage(stage.uid, { params: { levels } })}
                  />
                  <Lcd className="min-w-9">{params.levels}</Lcd>
                </label>
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-small text-dim">
          Phase 0 test pass. Real stages (Adjust, Downscale, Quantize, Dither) arrive in Phase 1.
        </p>
      </GroupBox>
    </aside>
  )
}
