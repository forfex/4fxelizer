// Imported maps (AO, cavity, …) that dither masks can use. Maps named like the texture load with it;
// each slot can also be filled or cleared by hand, and packed maps pick the channel they read.

import { MAP_CHANNELS, MAP_SLOTS, type MapSlot } from '@shared/maps'
import { clearMap, clearMaps, openMapFile, saveMap } from '@/actions'
import { useApp, type MapInfo } from '@/store'
import { Button } from './ui/button'
import { Segmented } from './ui/controls'
import { GroupBox, PanelBody } from './ui/retro'

export function MapsPanel() {
  const maps = useApp((s) => s.maps)
  const gpuReady = useApp((s) => s.gpu.status === 'ready')
  const loaded = Object.keys(maps).length
  return (
    <PanelBody>
      <GroupBox title="Maps">
        <p className="mb-2 text-small text-dim">
          Grayscale maps for dither masks (Dither › Mask) and Adjust's shading. Maps named like the texture, such as rock_ao.png or
          rock_orm.png next to rock.png, load with it. You can also drop map files on the window, or bake them from a model (Bake panel).
        </p>
        <div className="flex flex-col gap-1.5">
          {MAP_SLOTS.map((slot) => (
            <MapRow key={slot.id} slot={slot} map={maps[slot.id]} disabled={!gpuReady} />
          ))}
        </div>
        {loaded > 0 && (
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={() => clearMaps()}>
              Clear all
            </Button>
          </div>
        )}
      </GroupBox>
    </PanelBody>
  )
}

function MapRow({ slot, map, disabled }: { slot: (typeof MAP_SLOTS)[number]; map: MapInfo | undefined; disabled: boolean }) {
  const id: MapSlot = slot.id
  return (
    <div className="flex gap-2" title={slot.hint}>
      <div className="bevel-sunken flex size-10 shrink-0 items-center justify-center overflow-hidden bg-well">
        {map?.thumbnail ? (
          <img src={map.thumbnail} alt="" className="size-full object-contain [image-rendering:pixelated]" />
        ) : (
          <span className="text-small text-dim">—</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate font-semibold">{slot.label}</span>
          <Button size="sm" disabled={disabled} onClick={() => void openMapFile(id)} title={`Load a ${slot.label.toLowerCase()} map`}>
            Load…
          </Button>
          {map?.baked && (
            <Button size="sm" onClick={() => void saveMap(id)} title="Save as a PNG named so it loads with the texture next time">
              Save…
            </Button>
          )}
          {map && (
            <Button size="sm" onClick={() => clearMap(id)} title="Remove this map">
              ✕
            </Button>
          )}
        </div>
        {map ? (
          <>
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
          </>
        ) : (
          <span className="text-small text-dim">Not loaded</span>
        )}
      </div>
    </div>
  )
}
