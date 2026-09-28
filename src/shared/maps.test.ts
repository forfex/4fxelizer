import { describe, expect, it } from 'vitest'
import { detectMap, siblingMaps, textureBase } from './maps'

describe('map files', () => {
  it('recognizes map suffixes in common naming styles', () => {
    expect(detectMap('rock_ao.png')).toEqual({ base: 'rock', maps: [{ slot: 'ao', channel: 'luma' }] })
    expect(detectMap('Rock-AmbientOcclusion.TGA')?.maps[0]?.slot).toBe('ao')
    expect(detectMap('RockAmbientOcclusion.png')?.base).toBe('rock')
    expect(detectMap('rock_mixed_AO.png')).toEqual({ base: 'rock', maps: [{ slot: 'ao', channel: 'luma' }] })
    expect(detectMap('crate 02 Cavity.jpg')?.base).toBe('crate_02')
    expect(detectMap('wall_curvature.png')?.maps[0]?.slot).toBe('curvature')
    expect(detectMap('wall_Height.png')?.maps[0]?.slot).toBe('height')
    expect(detectMap('wall_metalness.png')?.maps[0]?.slot).toBe('metallic')
    expect(detectMap('rock.png')).toBeNull()
    expect(detectMap('ao.png')).toBeNull()
    expect(detectMap('rock_albedo.png')).toBeNull()
  })

  it('unpacks channel-packed maps', () => {
    expect(detectMap('T_Rock_ORM.png')).toEqual({
      base: 't_rock',
      maps: [
        { slot: 'ao', channel: 'r' },
        { slot: 'roughness', channel: 'g' },
        { slot: 'metallic', channel: 'b' }
      ]
    })
    expect(detectMap('rock_OcclusionRoughnessMetallic.png')?.maps).toHaveLength(3)
    expect(detectMap('rock_rma.png')?.maps.find((m) => m.slot === 'ao')?.channel).toBe('b')
  })

  it('matches a texture with its maps, ignoring color suffixes', () => {
    expect(textureBase('Rock_BaseColor.png')).toBe('rock')
    expect(textureBase('T_Rock_D.tga')).toBe('t_rock')
    expect(textureBase('rock.png')).toBe('rock')
    const files = ['rock_albedo.png', 'rock_ao.png', 'rock_ORM.tga', 'rock_ao.txt', 'rocky_ao.png', 'rock_normal.png', 'moss_ao.png']
    expect(siblingMaps('rock_albedo.png', files)).toEqual(['rock_ao.png', 'rock_ORM.tga'])
    expect(siblingMaps('rock.png', files)).toEqual(['rock_ao.png', 'rock_ORM.tga'])
  })
})
