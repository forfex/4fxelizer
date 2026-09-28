// Built-in palettes (classic hardware palettes and simple ramps).

export interface BuiltinPalette {
  name: string
  colors: string[]
}

const hexes = (s: string): string[] => s.trim().split(/\s+/).map((h) => `#${h.toLowerCase()}`)

const gray = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => {
    const v = Math.round((i / (n - 1)) * 255).toString(16).padStart(2, '0')
    return `#${v}${v}${v}`
  })

export const BUILTIN_PALETTES: BuiltinPalette[] = [
  {
    name: 'PICO-8',
    colors: hexes('000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa')
  },
  {
    name: 'NES',
    colors: [
      ...new Set(
        hexes(`
          7c7c7c 0000fc 0000bc 4428bc 940084 a80020 a81000 881400 503000 007800 006800 005800 004058 000000
          bcbcbc 0078f8 0058f8 6844fc d800cc e40058 f83800 e45c10 ac7c00 00b800 00a800 00a844 008888
          f8f8f8 3cbcfc 6888fc 9878f8 f878f8 f85898 f87858 fca044 f8b800 b8f818 58d854 58f898 00e8d8 787878
          fcfcfc a4e4fc b8b8f8 d8b8f8 f8b8f8 f8a4c0 f0d0b0 fce0a8 f8d878 d8f878 b8f8b8 b8f8d8 00fcfc f8d8f8`)
      )
    ]
  },
  { name: 'Game Boy (DMG)', colors: hexes('0f380f 306230 8bac0f 9bbc0f') },
  {
    name: 'CGA (16)',
    colors: hexes('000000 0000aa 00aa00 00aaaa aa0000 aa00aa aa5500 aaaaaa 555555 5555ff 55ff55 55ffff ff5555 ff55ff ffff55 ffffff')
  },
  { name: 'CGA mode 4 (palette 1, high)', colors: hexes('000000 55ffff ff55ff ffffff') },
  {
    name: 'Commodore 64',
    colors: hexes('000000 ffffff 68372b 70a4b2 6f3d86 588d43 352879 b8c76f 6f4f25 433900 9a6759 444444 6c6c6c 9ad284 6c5eb5 959595')
  },
  { name: '1-bit', colors: ['#000000', '#ffffff'] },
  { name: 'Grayscale 4', colors: gray(4) },
  { name: 'Grayscale 8', colors: gray(8) },
  { name: 'Grayscale 16', colors: gray(16) }
]
