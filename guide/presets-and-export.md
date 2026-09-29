# Presets and export

## Presets

**Presets** (toolbar › Presets, Ctrl+Shift+P) save the whole stack to reuse on other textures. The built-ins
come in three groups:

- **Consoles**: PSX 8bpp, PSX 4bpp, PSX 15-bit direct, N64, Saturn mesh, SNES, Mega Drive, NES-ish, Game Boy,
  Virtual Boy and PICO-8.
- **Computers**: CGA, EGA, VGA 256, Commodore 64 and Classic Mac.
- **Stylized**: Crunchy, Pixelate, Painted pixels, Clean edges, Blue-noise grain, Newsprint, Etching, Comic ink,
  Sunset gradient, Grime (needs AO and cavity maps), Dithered cutout and Seamless tiling. Each shows off a
  feature (masks, blending, error diffusion, dithered alpha, EPX upscaling, …); hover one for what it does.

Presets are small `.pxlook` files (older `.4fxpreset` files still load) you can share; load one with **File › Import Preset…**.

## Export

**File › Export…** (Ctrl+E) writes **PNG, TGA or BMP**, full color or **indexed**.

Indexed export keeps the palette's order and puts transparency at index 0. Indexed BMP has no alpha: transparent
pixels use index 0, and semi-transparent ones become opaque.

Colors are exported exactly as processed, with no color-space conversion and no alpha premultiplication.
