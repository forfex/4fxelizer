// Maps (AO, cavity, …) that stage masks and Adjust's shading use, and baking them from a model.
// Maps named like the texture load with it; each slot can also be filled or cleared by hand (or
// baked, with a model open), and packed maps pick the channel they read.

import { useState } from 'react'
import { BAKE_MAPS, type BakeMap } from '@shared/bake'
import { MAP_CHANNELS, MAP_SLOTS, type MapSlot } from '@shared/maps'
import { clearMap, clearMaps, openMapFile, saveMap } from '@/actions'
import { startBake } from '@/modelActions'
import { useApp, type MapInfo } from '@/store'
import { BakeSection, ModelBox, NoModelBox } from './BakeSection'
import { Button } from './ui/button'
import { Segmented } from './ui/controls'
import { HelpIcon } from './ui/icons'
import { GroupBox, PanelBody } from './ui/retro'

type Slot = (typeof MAP_SLOTS)[number]

const isBakeable = (id: MapSlot): id is BakeMap => (BAKE_MAPS as readonly string[]).includes(id)

export function MapsPanel() {
  const maps = useApp((s) => s.maps)
  const hasModel = useApp((s) => !!s.model)
  const gpuReady = useApp((s) => s.gpu.status === 'ready')
  const [help, setHelp] = useState(false)
  const loaded = MAP_SLOTS.filter((slot) => maps[slot.id])
  const empty = MAP_SLOTS.filter((slot) => !maps[slot.id])
  return (
    <PanelBody>
      <GroupBox title="Maps">
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-small text-dim">Grayscale maps for masks and Adjust's shading.</p>
            <Button
              size="icon"
              className="size-5 shrink-0"
              aria-pressed={help}
              aria-label="About maps"
              title="About maps"
              onClick={() => setHelp(!help)}
            >
              <HelpIcon className="size-3" />
            </Button>
          </div>
          {help && (
            <p className="text-small text-dim">
              Masks read them in Dither › Mask or any stage's Blending › Mask. Maps named like the texture, such as rock_ao.png or rock_orm.png next to
              rock.png, load with it. You can also drop map files on the window, or bake them from a model below.
            </p>
          )}
          {loaded.map((slot) => (
            <MapRow key={slot.id} slot={slot} map={maps[slot.id]!} hasModel={hasModel} />
          ))}
          {empty.length > 0 && (
            <div className="flex flex-col">
              {loaded.length > 0 && <span className="pt-1 pb-0.5 text-dim label-caps">Empty</span>}
              {empty.map((slot) => (
                <EmptySlot key={slot.id} slot={slot} disabled={!gpuReady} hasModel={hasModel} />
              ))}
            </div>
          )}
          {loaded.length > 0 && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => clearMaps()}>
                Clear all
              </Button>
            </div>
          )}
        </div>
      </GroupBox>
      {hasModel ? (
        <>
          <ModelBox />
          <BakeSection />
        </>
      ) : (
        <NoModelBox />
      )}
    </PanelBody>
  )
}

/** Bakes one map from the open model into its slot (with the bake settings below). */
function BakeButton({ slot }: { slot: Slot }) {
  const running = useApp((s) => s.bakeJob?.status === 'running')
  if (!isBakeable(slot.id)) return null
  const id = slot.id
  return (
    <Button size="sm" disabled={running} onClick={() => void startBake(id)} title={`Bake the ${slot.label.toLowerCase()} map from the model`}>
      Bake
    </Button>
  )
}

/** An empty slot: one line with its name and Load (and Bake, with a model open). */
function EmptySlot({ slot, disabled, hasModel }: { slot: Slot; disabled: boolean; hasModel: boolean }) {
  return (
    <div className="flex h-7 items-center gap-1 border-b-px border-line last:border-b-0" title={slot.hint}>
      <span className="min-w-0 flex-1 truncate text-dim">{slot.label}</span>
      {hasModel && <BakeButton slot={slot} />}
      <Button size="sm" disabled={disabled} onClick={() => void openMapFile(slot.id)} title={`Load a ${slot.label.toLowerCase()} map`}>
        Load…
      </Button>
    </div>
  )
}

function MapRow({ slot, map, hasModel }: { slot: Slot; map: MapInfo; hasModel: boolean }) {
  const id: MapSlot = slot.id
  return (
    <div className="flex gap-2" title={slot.hint}>
      <div className="bevel-sunken flex size-10 shrink-0 items-center justify-center overflow-hidden bg-well">
        {map.thumbnail ? (
          <img src={map.thumbnail} alt="" className="size-full object-contain [image-rendering:pixelated]" />
        ) : (
          <span className="text-small text-dim">—</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1">
          <span className="min-w-0 flex-1 truncate font-semibold">{slot.label}</span>
          {hasModel && <BakeButton slot={slot} />}
          <Button size="sm" onClick={() => void openMapFile(id)} title={`Load a ${slot.label.toLowerCase()} map`}>
            Load…
          </Button>
          {map.baked && (
            <Button size="sm" onClick={() => void saveMap(id)} title="Save as a PNG named so it loads with the texture next time">
              Save…
            </Button>
          )}
          <Button size="sm" onClick={() => clearMap(id)} title="Remove this map">
            ✕
          </Button>
        </div>
        <span className="truncate text-small text-dim" title={`${map.name} (${map.width}×${map.height})`}>
          {map.name} · {map.width}×{map.height}
        </span>
        {!map.baked && (
          <Segmented
            value={map.channel}
            onChange={(channel) => useApp.getState().setMapChannel(id, channel)}
            options={MAP_CHANNELS.map((c) => ({ value: c.id, label: c.label, hint: `Read the mask from: ${c.hint}` }))}
          />
        )}
      </div>
    </div>
  )
}
