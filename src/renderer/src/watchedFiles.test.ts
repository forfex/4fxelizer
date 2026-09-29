import { describe, expect, it } from 'vitest'
import type { TextureEntry } from './stack/textures'
import { changedRoles, watchedPaths, type Watched } from './watchedFiles'

const map = (path?: string, baked?: boolean) => ({ name: 'm', width: 1, height: 1, channel: 'luma' as const, version: 1, thumbnail: null, path, baked })

const texture = (id: string, path: string | undefined, maps: TextureEntry['maps']): TextureEntry => ({
  id,
  image: { name: 'x.png', width: 4, height: 4, version: 1, path },
  maps,
  thumbnail: null,
  materials: [],
  view: null
})

const state: Watched = {
  liveReload: true,
  textures: [
    texture('rock', '/t/rock.png', { ao: map('/t/rock_ao.png'), cavity: map(undefined, true), roughness: map('/t/rock_orm.png'), metallic: map('/t/rock_orm.png') }),
    texture('moss', '/t/moss.png', { ao: map('/t/rock_ao.png') })
  ],
  model: {
    name: 'rock.gltf',
    path: '/t/rock.gltf',
    resources: ['/t/rock.bin'],
    triangles: 1,
    vertices: 3,
    uvSets: 1,
    materials: [],
    warnings: [],
    version: 1
  }
}

describe('live reload', () => {
  it('watches every texture, file maps (once each), the model and its files', () => {
    expect(watchedPaths(state)).toEqual(['/t/rock.png', '/t/rock_ao.png', '/t/rock_orm.png', '/t/moss.png', '/t/rock.gltf', '/t/rock.bin'])
  })

  it('watches nothing when turned off, and skips files without a path', () => {
    expect(watchedPaths({ ...state, liveReload: false })).toEqual([])
    expect(watchedPaths({ liveReload: true, textures: [texture('a', undefined, {})], model: null })).toEqual([])
  })

  it('tells what a changed file is', () => {
    expect(changedRoles(state, '/t/rock.png')).toEqual({ textures: ['rock'], map: false, model: false })
    expect(changedRoles(state, '/t/moss.png')).toEqual({ textures: ['moss'], map: false, model: false })
    expect(changedRoles(state, '/t/rock_orm.png')).toEqual({ textures: [], map: true, model: false })
    expect(changedRoles(state, '/t/rock.bin')).toEqual({ textures: [], map: false, model: true })
    expect(changedRoles(state, '/t/other.png')).toEqual({ textures: [], map: false, model: false })
  })
})
