# Stages and dithering

A texture is shaped by a stack of stages. Add them in the stack panel, drag them into any order, and switch them
on and off. Every stage has an **opacity**, a **blend mode** and a **mask** over its input (under **Blending**; see
[stage masks](masks-and-maps.md#stage-masks)). Click a stage to preview the image
at that point; **Split View** (Ctrl+\\) compares before and after.

| Stage | What it does |
|---|---|
| **Adjust** | Brightness, contrast, gamma, saturation, hue, levels, sharpen, and shading from AO and cavity maps. |
| **Downscale** | Nearest, bilinear, bicubic, box, Lanczos, dominant color, median, edge-preserving or contrast-aware; to a longest side, an exact size or a scale, optionally power-of-two. |
| **Upscale** | ×2–×16 or back to the original size, with the N64 3-point filter, bilinear, bicubic, sharp bilinear, Lanczos, Scale2x/Scale3x (EPX, for pixel art) or nearest. |
| **Quantize** | Snap to a [palette](palettes.md) (perceptual OKLab or RGB matching) or to N levels per channel (32 = PSX 15-bit). |
| **Dither** | Ordered or error diffusion, to a palette, to levels, or pattern only. |

Tip: Downscale → Dither → Upscale with the 3-point filter gives the N64 blur.

## Dithering

**Ordered**: Bayer 2×2 to 16×16, blue noise, white noise, IGN, clustered dots, halftone, lines, checker,
crosshatch, the N64 magic square, or your own pattern image. Palette mixing: offset, two nearest or Knoll.

**Error diffusion**: Floyd–Steinberg, Atkinson, Jarvis–Judice–Ninke, Stucki, Burkes and three Sierra variants,
with optional serpentine scanning.

A Dither stage can also be limited to parts of the image with a [mask](masks-and-maps.md), with a different
pattern running outside it.

## Tiling textures

**Wrap edges** makes error diffusion and mask filtering tile seamlessly, and Upscale has its own edge wrap.
**View › Tiling View** (Ctrl+T) repeats the texture 3×3 so you can spot seams.
