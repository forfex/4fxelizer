# Masks and maps

## Masks

A Dither stage can work only where you want it. Its **mask** comes from:

- **the image**: edges, flats, shadows, midtones, highlights, saturated, grays
- **a map**: AO, cavity, curvature, edge, thickness, height, roughness, metallic

Two sources can be combined (multiply, add, min, max) and each inverted, then the result is blurred and shaped by
strength and gamma. The **mask view** shows it on the image, and a different pattern can run outside the mask.

### Stage masks

Every other stage has a mask too, under **Blending › Mask**: the same image and map sources, combined, inverted
and blurred the same way. Where the mask is white the stage applies fully; where it's black its input shows
through (an Adjust that only darkens the crevices, a Downscale only on flat areas). **View** shows the mask.
Turn on **Wrap edges** for tiling textures when the mask uses edges or blur.

## Maps

Maps load by themselves when they sit next to the texture with a recognizable name, for example
`rock_ao.png`, `Rock_AmbientOcclusion.tga` or `T_Rock_ORM.png`. ORM, ARM and RMA files are split into their
channels.

You can also drop maps on the window or load them per slot in the **Maps** panel. They are sampled in UV, so
their size doesn't need to match the texture's.

Maps belong to the texture: opening another texture clears them and loads its own. Presets refer to maps by slot,
so a preset that uses the AO map works on any texture that has one.

No maps? [Bake them from the model](3d.md#map-baking).
