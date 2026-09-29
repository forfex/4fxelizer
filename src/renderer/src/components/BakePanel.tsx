// Bakes maps (AO, cavity, curvature, edge, thickness, height, up-facing) from the loaded model into
// the map slots, for the texture set the open texture belongs to.

import { BAKE_MAPS, BAKE_NUMBERS, BAKE_SIZES, type BakeSettings } from '@shared/bake'
import { MAP_SLOTS } from '@shared/maps'
import { closeModel, openModel, openTextureOf, startBake, stopBake } from '@/modelActions'
import { useApp } from '@/store'
import { Button } from './ui/button'
import { Checkbox, Field, ParamSlider, Segmented } from './ui/controls'
import { GroupBox, Led, PanelBody } from './ui/retro'
import { Select } from './ui/select'

type NumberKey = keyof typeof BAKE_NUMBERS

/** A bake setting slider; `percent` shows a fraction of the model's size as a percentage. */
function BakeSlider({ k, label, hint, percent, log }: { k: NumberKey; label: string; hint: string; percent?: boolean; log?: boolean }) {
  const value = useApp((s) => s.bake[k])
  const spec = BAKE_NUMBERS[k]
  const f = percent ? 100 : 1
  return (
    <ParamSlider
      label={label}
      hint={hint}
      value={value * f}
      min={spec.min * f}
      max={spec.max * f}
      step={spec.integer ? 1 : percent ? 0.1 : 0.01}
      scale={log ? 'log' : 'linear'}
      suffix={percent ? '%' : undefined}
      onChange={(v) => useApp.getState().setBake({ [k]: v / f } as Partial<BakeSettings>)}
    />
  )
}

export function BakePanel() {
  const model = useApp((s) => s.model)
  const gpuReady = useApp((s) => s.gpu.status === 'ready')
  if (!model) {
    return (
      <PanelBody>
        <GroupBox title="Model">
          <p className="mb-2 text-small text-dim">
            Open a model (glTF, GLB, FBX or OBJ) to see the texture on it and bake AO, cavity, curvature and other maps from its shape.
          </p>
          <Button variant="primary" onClick={openModel} disabled={!gpuReady}>
            Open Model…
          </Button>
        </GroupBox>
      </PanelBody>
    )
  }
  return (
    <PanelBody>
      <ModelBox />
      <MapsBox />
      <SettingsBox />
      <BakeBox />
    </PanelBody>
  )
}

function ModelBox() {
  const model = useApp((s) => s.model)!
  const material = useApp((s) => s.modelMaterial)
  const uvSet = useApp((s) => s.modelUvSet)
  const image = useApp((s) => s.image?.name)
  const { setModelMaterial, setModelUvSet } = useApp.getState()
  const texture = model.materials[material]?.texture
  return (
    <GroupBox title="Model">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-semibold" title={model.path ?? model.name}>
            {model.name}
          </span>
          <Button size="sm" onClick={closeModel} title="Close the model">
            Close
          </Button>
        </div>
        <span className="text-small text-dim">
          {model.triangles.toLocaleString('en-US')} triangles · {model.vertices.toLocaleString('en-US')} vertices · {model.materials.length}{' '}
          {model.materials.length === 1 ? 'material' : 'materials'}
        </span>
        <Field label="Texture set" hint="The material the open texture belongs to: the 3D view puts the texture on it, and bakes use its UVs.">
          <Select
            className="min-w-0 flex-1"
            value={String(material)}
            onValueChange={(v) => setModelMaterial(Number(v))}
            options={model.materials.map((m, i) => ({
              value: String(i),
              label: `${m.name} · ${m.triangles.toLocaleString('en-US')} tris`,
              hint: m.texture ? `Base color: ${m.texture}` : 'No texture'
            }))}
          />
        </Field>
        {texture && texture !== image && (
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-small text-dim" title={texture}>
              Its texture: {texture}
            </span>
            <Button size="sm" onClick={() => void openTextureOf(material)}>
              Open
            </Button>
          </div>
        )}
        {model.uvSets > 1 && (
          <Field label="UV set" hint="The UV set textures and bakes use (the first is the usual one).">
            <Segmented
              value={String(uvSet)}
              onChange={(v) => setModelUvSet(Number(v))}
              options={Array.from({ length: model.uvSets }, (_, i) => ({ value: String(i), label: `UV ${i + 1}` }))}
            />
          </Field>
        )}
        {model.warnings.map((w) => (
          <p key={w} className="text-small text-led-warn">
            {w}
          </p>
        ))}
      </div>
    </GroupBox>
  )
}

function MapsBox() {
  const maps = useApp((s) => s.bake.maps)
  return (
    <GroupBox title="Bake maps">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-x-3 gap-y-1.5">
        {BAKE_MAPS.map((m) => {
          const slot = MAP_SLOTS.find((s) => s.id === m)!
          return (
            <Checkbox
              key={m}
              label={slot.label}
              hint={slot.hint}
              checked={maps[m]}
              onCheckedChange={(on) => useApp.getState().setBake({ maps: { ...maps, [m]: on } })}
            />
          )
        })}
      </div>
    </GroupBox>
  )
}

function SettingsBox() {
  const bake = useApp((s) => s.bake)
  const { setBake } = useApp.getState()
  const m = bake.maps
  return (
    <GroupBox title="Settings">
      <div className="flex flex-col gap-2">
        <Field label="Size" hint="Resolution of the baked maps. Masks read maps by UV, so it doesn't need to match the texture.">
          <Select
            className="w-32"
            value={String(bake.size)}
            onValueChange={(v) => setBake({ size: Number(v) })}
            options={BAKE_SIZES.map((s) => ({ value: String(s), label: `${s} × ${s}` }))}
          />
        </Field>
        <BakeSlider k="padding" label="Padding" hint="Texels the UV islands grow outward, so maps don't show seams when sampled or downscaled." />
        {(m.ao || m.cavity) && (
          <Checkbox
            label="Ignore back faces"
            hint="Hits on the back of faces don't darken AO or cavity. Helps with open meshes and parts that poke through."
            checked={bake.aoIgnoreBackfaces}
            onCheckedChange={(aoIgnoreBackfaces) => setBake({ aoIgnoreBackfaces })}
          />
        )}
        {m.ao && (
          <Section title="Ambient occlusion">
            <BakeSlider k="aoSamples" label="Samples" hint="Rays per texel. More is smoother and slower." log />
            <BakeSlider k="aoDistance" label="Distance" hint="How far rays look for blockers, as a share of the model's size." percent log />
            <BakeSlider k="aoFalloff" label="Falloff" hint="0: every blocker darkens fully. 1: far blockers darken less." />
          </Section>
        )}
        {m.cavity && (
          <Section title="Cavity">
            <BakeSlider k="cavitySamples" label="Samples" hint="Rays per texel." log />
            <BakeSlider k="cavityDistance" label="Distance" hint="How deep a crevice has to be to darken, as a share of the model's size." percent log />
          </Section>
        )}
        {(m.curvature || m.edge) && (
          <Section title="Curvature and edge">
            <BakeSlider k="edgeSamples" label="Samples" hint="Probes per texel." log />
            <BakeSlider k="edgeWidth" label="Width" hint="How far from an edge or crease it still shows, as a share of the model's size." percent log />
            <BakeSlider k="edgeStrength" label="Strength" hint="Contrast: higher makes gentle curves show too." log />
          </Section>
        )}
        {m.thickness && (
          <Section title="Thickness">
            <BakeSlider k="thicknessSamples" label="Samples" hint="Rays per texel." log />
            <BakeSlider k="thicknessDistance" label="Distance" hint="Thickness that reads as white, as a share of the model's size." percent log />
          </Section>
        )}
      </div>
    </GroupBox>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t-px border-line pt-2">
      <span className="text-dim label-caps">{title}</span>
      {children}
    </div>
  )
}

function BakeBox() {
  const job = useApp((s) => s.bakeJob)
  const uvSets = useApp((s) => s.model?.uvSets ?? 0)
  const running = job?.status === 'running'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {running ? (
          <Button onClick={stopBake} title="Stop; the maps keep the samples taken so far">
            Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void startBake()} disabled={!uvSets} title="Bake the chosen maps into the map slots">
            Bake
          </Button>
        )}
        <Led state={running ? 'busy' : job ? 'on' : 'off'} />
        <span className="min-w-0 flex-1 truncate text-small text-dim">
          {running ? `${job.label} · ${Math.floor(job.progress * 100)}%` : (job?.label ?? 'Maps land in the Maps panel.')}
        </span>
      </div>
      {running && (
        <div className="bevel-sunken h-2.5 overflow-hidden rounded-fx border-px border-edge bg-well" role="progressbar" aria-valuenow={Math.floor(job.progress * 100)}>
          <div className="h-full bg-accent" style={{ width: `${job.progress * 100}%` }} />
        </div>
      )}
    </div>
  )
}
