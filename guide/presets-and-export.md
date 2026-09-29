# Presets and export

## Presets

**Presets** (toolbar › Presets, Ctrl+Shift+P) save the whole stack to reuse on other textures. Built-ins: PSX 8bpp,
PSX 4bpp, PSX 15-bit, N64, NES-ish, Game Boy and Crunchy.

Presets are small `.pxlook` files (older `.4fxpreset` files still load) you can share; load one with **File › Import Preset…**.

## Export

**File › Export…** (Ctrl+E) writes **PNG, TGA or BMP**, full color or **indexed**.

Indexed export keeps the palette's order and puts transparency at index 0. Indexed BMP has no alpha: transparent
pixels use index 0, and semi-transparent ones become opaque.

Colors are exported exactly as processed, with no color-space conversion and no alpha premultiplication.
