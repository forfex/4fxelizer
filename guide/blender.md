# Blender link

Paint in Blender and watch the 4FXELIZER result on the model while you paint, without saving or exporting anything.
Blender sends the texture you paint to 4FXELIZER after every stroke. 4FXELIZER runs its stack and sends the result
back, and Blender shows it on the model in place of your texture.

It works with [Ucupaint](https://extensions.blender.org/add-ons/ucupaint/) and with plain image painting.

## Setting it up

1. In 4FXELIZER, turn on **File › Blender Link › Link with Blender** (also in Settings › General).
2. Save the add-on with **File › Blender Link › Save Blender Add-on…**.
3. In Blender (4.2 or newer): **Edit › Preferences › Add-ons › Install from Disk**, pick `fxelizer_link.py` and
   tick **4FXELIZER Link**.
4. Open the 3D view's sidebar (**N**) and its **4FXELIZER** tab. The image editor has the same tab.

The add-on connects on its own once you link something, and again whenever 4FXELIZER starts. The status line in the
tab (and in 4FXELIZER's Settings) shows whether they are connected.

## Two kinds of link

**Link Image** sends one image as it is. It picks the image you paint on: the active paint slot, or Ucupaint's
active layer. It's the fastest kind: it updates during a stroke, not only after it. With Ucupaint, the processed
layer is shown inside the layer stack, so the layers above and below it stay as they are.

**Link Material Channel** sends what a channel adds up to: Ucupaint's combined Color (all layers, masks and blend
modes), or whatever feeds the Principled BSDF's Base Color. Blender bakes it after every stroke, with Cycles in a
single sample. That takes a fraction of a second for most textures, so it updates when you lift the brush. When
Ucupaint's alpha is on for the channel, the alpha is baked too.

Each link opens as a texture tab in 4FXELIZER, with the shared stack or a separate one like any other texture. The
tab stays bound to its link: it keeps its stack when Blender sends it again, and after a project is saved and opened
again.

## Settings per link

- **Show on model** (the eye in the list): the result replaces the image or channel in the material. Your strokes
  still go to the original image.
- **Sharp pixels**: shows the result with nearest-pixel filtering.
- **Auto update**: send after every stroke or change. Off: only **Send Now** sends.
- **Bake size**, **Margin** and **UV Map** (channels): the size of the baked texture (0 uses the largest image the
  material uses), how far it extends past the UV islands (so downscaling doesn't pull in the background), and the
  UV map it's baked with.

## When it updates

At the top of the tab, under the connection status:

- **Update**: **While painting** sends image links during a stroke as well (material channels still wait until you
  lift the brush); **When you lift the brush** sends once each stroke ends; **Only with Send Now** sends nothing on
  its own.
- **Rate**: the least time between two updates of a link: **Instant**, 100 ms, 250 ms, 500 ms, 1 s or 2 s. A slower
  rate keeps Blender smoother on big textures.

The same settings are in the add-on's preferences, with the port (the same as in 4FXELIZER's Settings), automatic
connecting, and the delay before a channel bakes.

## Good to know

- Saving the .blend file puts the original node links back first, so the file never depends on the add-on.
- The connection is local to your computer (127.0.0.1); nothing leaves the machine.
- A link keeps working while 4FXELIZER is minimized or behind Blender.
- UDIM images aren't supported.
