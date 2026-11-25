import { describe, expect, it } from 'vitest'
import { batchInputs, batchOutputName } from './batch'

describe('batchInputs', () => {
  it('keeps images and sorts them by name, numbers in order', () => {
    expect(batchInputs(['wall10.png', 'notes.txt', 'wall2.png', 'Floor.TGA', 'model.glb'])).toEqual(['Floor.TGA', 'wall2.png', 'wall10.png'])
  })

  it('skips files the app exported earlier', () => {
    expect(batchInputs(['rock.png', 'rock_4fx.png', 'ROCK_4FX.tga'])).toEqual(['rock.png'])
  })

  it('skips a map that sits next to its texture, but keeps one on its own', () => {
    expect(batchInputs(['rock.png', 'rock_ao.png', 'rock_cavity.png'])).toEqual(['rock.png'])
    expect(batchInputs(['moss_ao.png'])).toEqual(['moss_ao.png'])
  })
})

describe('batchOutputName', () => {
  it('keeps the texture\'s name, with the export format\'s extension', () => {
    expect(batchOutputName('rock.jpg', 'png')).toBe('rock.png')
    expect(batchOutputName('wall.v2.tga', 'bmp')).toBe('wall.v2.bmp')
  })
})
