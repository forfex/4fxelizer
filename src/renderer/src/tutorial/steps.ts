// The tutorial: a short tour of the basics (the stack, then palettes). Each step points at a part
// of the window (an element marked `data-tour="…"`) and says what it is for; the app stays usable
// meanwhile, so the artist can try each thing before moving on. Pure data and geometry, drawn by
// components/Tutorial.tsx.

/** What a step sets up before it shows (done by the component: panels, open stage cards). */
export type TutorialPrepare = 'stack' | 'open-downscale' | 'open-dither' | 'palettes'

/** Something the step asks the artist to do; the step shows when it is done. */
export type TutorialCheck = 'image' | 'downscaled' | 'dither-on'

export interface TutorialStep {
  id: string
  title: string
  /** Paragraphs. */
  text: string[]
  /** `data-tour` name of the element the step points at; none = shown in the middle of the window. */
  target?: string
  prepare?: TutorialPrepare
  check?: TutorialCheck
  /** What the step asks for, shown with its done light. */
  task?: string
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome',
    text: [
      '4FXELIZER turns a detailed texture into a small one with few colors, like the textures of PlayStation-era games.',
      'This tour shows the two things you will use most: the stack and palettes. The app keeps working while it is open, so try each step as you go.'
    ]
  },
  {
    id: 'open',
    title: 'Open a texture',
    text: ['Open… loads one or more images. You can also drop files on the window.'],
    target: 'open',
    check: 'image',
    task: 'Open a texture, or use the sample.'
  },
  {
    id: 'viewer',
    title: 'The viewer',
    text: [
      'The viewer shows your texture. With Compare on, the left side of the divider is the original and the right side is the result; drag the divider to move it.',
      'Scroll to zoom and drag to pan.'
    ],
    target: 'viewer'
  },
  {
    id: 'stack',
    title: 'The stack',
    text: [
      'The stack is the list of steps your texture goes through, from top to bottom. Each step is a stage, and each stage works on the result of the one above it.',
      'A new stack has three stages that change nothing yet: Adjust, Downscale and Dither.'
    ],
    target: 'stack',
    prepare: 'stack'
  },
  {
    id: 'downscale',
    title: 'Make it small',
    text: [
      'Click a stage to open its settings. Downscale sets the size of the result.',
      'Under Size, choose Longest and pick 128: the longest side becomes 128 pixels.'
    ],
    target: 'stage-downscale',
    prepare: 'open-downscale',
    check: 'downscaled',
    task: 'Make the result smaller than the original.'
  },
  {
    id: 'dither',
    title: 'Reduce the colors',
    text: [
      'Dither limits the texture to a small set of colors and mixes them in a pattern to fake the ones in between.',
      'It starts switched off. The light on the left of every stage turns it on and off, which is also a quick way to see what a stage does.'
    ],
    target: 'stage-dither',
    prepare: 'open-dither',
    check: 'dither-on',
    task: 'Click the light to turn Dither on.'
  },
  {
    id: 'stage-tools',
    title: 'Working with stages',
    text: [
      'Drag a stage by its dotted grip to change the order; the order changes the result. The ⋯ button duplicates or removes a stage, and the square button shows the texture as it is after that stage.',
      'Add stage adds more: Quantize, Upscale, or a second Adjust.'
    ],
    target: 'add-stage',
    prepare: 'stack'
  },
  {
    id: 'palette',
    title: 'Palettes',
    text: [
      'A palette is the set of colors the result may use. Dither made one for itself from your texture; it is listed here.',
      'You can keep several palettes, import them from files, and choose which one a stage uses with "Colors from" on its card.'
    ],
    target: 'palette-list',
    prepare: 'palettes'
  },
  {
    id: 'palette-generate',
    title: 'Choosing how many colors',
    text: [
      'A generated palette picks its colors from the texture. Colors sets how many: 16 gives a strong retro look, 256 stays close to the original.',
      'Method changes how they are picked. The palette updates by itself when the texture or these settings change.'
    ],
    target: 'palette-generate',
    prepare: 'palettes'
  },
  {
    id: 'palette-colors',
    title: 'Editing colors',
    text: [
      'These are the palette\'s colors. Click one to change it, and use + Color to add your own.',
      'Pick takes a color from the texture, and Pick from screen takes one from anywhere on your screen.'
    ],
    target: 'palette-colors',
    prepare: 'palettes'
  },
  {
    id: 'presets',
    title: 'Presets',
    text: [
      'A preset is a whole stack with its palettes. The built-in ones imitate consoles and computers, and are a good starting point.',
      'Init brings back the empty starting stack. Save current as preset keeps your own.'
    ],
    target: 'presets'
  },
  {
    id: 'export',
    title: 'Export',
    text: [
      'Export… saves the result as PNG, TGA or BMP, in full color or indexed with its palette.',
      'That is the basics. You can open this tour again from Help › Tutorial.'
    ],
    target: 'export'
  }
]

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Space kept between the callout and what it points at, and from the window's edges. */
export const CALLOUT_GAP = 12

/**
 * Where the callout goes: beside its target when there is room (right, then left), else below or
 * above it, always inside the window. Without a target, the middle of the window.
 */
export function placeCallout(target: Rect | null, size: { width: number; height: number }, viewport: { width: number; height: number }): { x: number; y: number } {
  const clampX = (x: number): number => Math.max(CALLOUT_GAP, Math.min(x, viewport.width - size.width - CALLOUT_GAP))
  const clampY = (y: number): number => Math.max(CALLOUT_GAP, Math.min(y, viewport.height - size.height - CALLOUT_GAP))
  if (!target) return { x: clampX((viewport.width - size.width) / 2), y: clampY((viewport.height - size.height) / 2) }
  const right = target.x + target.width + CALLOUT_GAP
  const left = target.x - size.width - CALLOUT_GAP
  if (right + size.width + CALLOUT_GAP <= viewport.width) return { x: right, y: clampY(target.y) }
  if (left >= CALLOUT_GAP) return { x: left, y: clampY(target.y) }
  const below = target.y + target.height + CALLOUT_GAP
  const above = target.y - size.height - CALLOUT_GAP
  const x = clampX(target.x + (target.width - size.width) / 2)
  if (below + size.height + CALLOUT_GAP <= viewport.height) return { x, y: below }
  if (above >= CALLOUT_GAP) return { x, y: above }
  // No free side (the target fills the window): sit in its lower right corner.
  return { x: clampX(viewport.width), y: clampY(viewport.height) }
}
