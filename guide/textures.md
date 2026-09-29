# Several textures

## Opening textures

**File › Open Textures…** (Ctrl+O) opens several files at once, and dropping images on the window opens each one.
Every texture gets a tab in the viewer's header: click a tab to work on it, **×** or a middle-click closes it, and
**+** opens more. **View › Next / Previous Texture** (Ctrl+Tab / Ctrl+Shift+Tab) steps through them, and
**File › Close Texture** (Ctrl+F4, macOS: Shift+Cmd+W) closes the one you're on.

Each texture keeps its own maps and zoom. Maps you drop go to the texture named like them (`rock_ao.png` to
`rock.png`), or to the texture you're on.

The **Textures** panel shows every texture with a preview of its source and its result. Click a card to work on
that texture.

## One stack for all, or a stack of its own

All textures share one stack: edit it on any texture and every texture on it changes the same way. To process one
texture differently, switch it to **Separate** (on its card in the Textures panel, or **Stack › Source** in the
Stack panel). It starts as a copy of the shared stack and changes only that texture from then on. **Shared** puts
it back on the shared stack and drops its own (Undo brings it back). A small magenta mark on the tab shows a
texture with a separate stack.

Undo and redo cover every texture's stack. When an undo changes a texture you're not on, that texture is shown.

## Generated palettes

On the shared stack, a palette generated from the image (for example a Dither stage's **Generated** colors)
gets colors of its own for each texture by default, generated from that texture's pixels. **Generate ›
Textures: One for all** generates one set of colors from all textures on the shared stack together, so they share
a palette, like textures sharing a CLUT on a console.

## Models with several materials

Opening a model opens the textures its materials use, each in a tab, and draws each material with its texture's
result in the 3D view. Materials using the same file (an atlas) share one texture.

With a multi-material model, the Textures panel lists the **Materials**: pick which open texture each one is drawn
with, or **Import…** a texture for it. The Bake panel's **Texture set** switches to the texture of the material
you pick; bakes cover every material drawn with the texture you're on, and the maps go to that texture. Baking
with no texture open makes a blank one to hold the maps.

A model with one material shows whichever texture you're on.

## Export

**File › Export…** › **Textures: All** writes every texture's result into one folder, each named like its texture
(`rock_4fx.png`). An indexed export against a generated palette uses each texture's own colors of it. The Textures
panel's **Export all…** opens the dialog set to all textures.

Projects save every open texture, with its maps, its separate stack and the materials it's drawn on.
