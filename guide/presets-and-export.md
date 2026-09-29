# Projects, presets and export

## Projects

**File › Save Project** (Ctrl+S) saves everything you're working on to a `.pxproj` file: the stack, its
palettes, the texture, its maps and the model with its texture set and UV set. **File › Open Project…** (or
dropping a `.pxproj` on the window) brings it all back, with fresh undo history. **Save Project As…**
(Ctrl+Shift+S) saves a copy under another name.

The project refers to your texture, map and model files where they are; it doesn't copy them. It stores each
path both absolute and relative to the project, so you can move or copy a folder with the project and its files
inside, or send it to someone else, and it still opens. A file it can't find is also looked for by name next to
the project; anything still missing is reported, and the rest opens. Maps baked from the model, and a texture that
only exists inside the model, are stored in the project itself.

The title bar shows the project's name, with `*` when it has unsaved changes. Opening another project or closing
the window then asks whether to save first.

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
