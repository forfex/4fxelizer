# Troubleshooting

## GPU

4FXELIZER needs a GPU with **WebGPU** support: any reasonably recent NVIDIA, AMD, Intel or Apple GPU with current
drivers.

If you see "No WebGPU" or a blank viewer:

1. Update your GPU drivers.
2. Open **Help › GPU Diagnostics…** to see what the app found.
3. From a terminal, `4fxelizer --gpu-report=report.json` writes the same report without opening a window. Attach
   it to a [bug report](https://github.com/forfex/4fxelizer/issues).

## Install warnings

The builds aren't code-signed yet.

- **Windows**: SmartScreen may warn about an unknown publisher. Click **More info › Run anyway**.
- **macOS**: if the app is reported as damaged, run `xattr -cr /Applications/4FXELIZER.app` in Terminal once.

## Linux

The app turns on WebGPU and Vulkan by default. If it won't start, launch it with `FXELIZER_NO_GPU_FLAGS=1` to use
Electron's defaults instead.

## Tested hardware

Tested so far on Windows 11 (NVIDIA RTX 5070 Ti). macOS and Linux builds are built and launched in CI but haven't
been checked on real GPUs yet; reports are very welcome.
