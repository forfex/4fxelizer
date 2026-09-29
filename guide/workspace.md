# Workspace and shortcuts

## Panels and layouts

Panels dock, tab together, float over the viewer and resize. The toolbar's workspace menu switches between
built-in layouts (**Essentials**, **Wide viewer**, **Palette editing**, **3D**, **Floating**), saves your own and
resets them. Open textures are tabs in the viewer's header; the **Textures** panel shows them with previews.

## Themes

Five themes, in **View › Theme**, the toolbar's theme menu or **Settings › Appearance**:

- **Dark**: plum with purple and magenta accents (the default)
- **Night**: neutral greyscale, for dim rooms and judging colors without tinted chrome around the image
- **Light**
- **Matrix**: green phosphor
- **Retro**: the classic silver-grey desktop

## Settings

**Edit › Settings…** (Ctrl+,) or the toolbar's settings button. Pick a category on the left, or **All** to see
everything; the search box finds a setting in any category.

- **General**: interface scale (80–150%), live reload of changed files, the settings folder, and restoring the
  default settings.
- **Appearance**: the theme.
- **Mouse**: how the mouse wheel reaches sliders and dropdowns: once the pointer has rested on one (and for how
  long), only after you click it, always, or never. A test slider and dropdown show how it feels.
- **Viewer**: the 2D / 3D view mode, invert the wheel zoom (2D viewer and 3D view), and the grid, split and tiling views.
- **Keybinds**: change any menu shortcut. Click a shortcut and press the new keys; Backspace removes it, Esc
  cancels. A shortcut taken from another command leaves that one without a shortcut (the dialog says which).
  Clipboard, full screen and the menu bar's own keys (Alt+letter, F10) can't be reassigned.
- **GPU**: the GPU in use and, on computers with two (a laptop with integrated and discrete graphics), which one
  to prefer. The choice applies after a restart; **Restart now** closes the open image, so export or save a
  preset first.

## Good to know

- Undo and redo cover the stacks and palettes of every texture.
- Sliders and dropdowns take the mouse wheel once you rest the pointer on them for a second (or click them), so
  scrolling a panel never changes a value by accident. **Settings › Mouse** changes this.
- Settings, the theme, view options (including the 2D / 3D view mode), export format, 3D and bake settings, panel layout and window placement are
  remembered between sessions.
- On Windows and Linux the menus live in the app's own title bar: Alt or F10 moves to them, Alt+letter opens one.
  macOS keeps its system menu bar.
- **Help › GPU Diagnostics…** shows what your GPU supports.

## Keyboard shortcuts

The defaults; change them in **Settings › Keybinds**. On macOS, use Cmd instead of Ctrl.

| Action | Shortcut |
|---|---|
| Open textures | Ctrl+O |
| Close texture | Ctrl+F4 (macOS: Shift+Cmd+W) |
| Next / previous texture | Ctrl+Tab / Ctrl+Shift+Tab |
| Open model | Ctrl+Shift+O |
| Export | Ctrl+E |
| Presets | Ctrl+Shift+P |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y (macOS: Shift+Cmd+Z) |
| Settings | Ctrl+, |
| Fit to window | Ctrl+0 |
| Actual pixels | Ctrl+1 |
| Zoom in / out | Ctrl+= / Ctrl+- |
| Pixel grid | Ctrl+G |
| Split view | Ctrl+\\ |
| Tiling view | Ctrl+T |
| 2D / 2D and 3D / 3D view | Ctrl+Shift+1 / 2 / 3 |
| Pick a color | Alt+click in the viewer |
| Full screen | F11 (macOS: Ctrl+Cmd+F) |
