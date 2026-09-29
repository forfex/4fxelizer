import { describe, expect, it } from 'vitest'
import { changedRoles, watchedPaths, type Watched } from './watchedFiles'

const map = (path?: string, baked?: boolean) => ({ name: 'm', width: 1, height: 1, channel: 'luma' as const, version: 1, thumbnail: null, path, baked })

const state: Watched = {
  liveReload: true,
  image: { name: 'rock.png', width: 4, height: 4, version: 1, path: '/t/rock.png' },
  maps: { ao: map('/t/rock_ao.png'), cavity: map(undefined, true), roughness: map('/t/rock_orm.png'), metallic: map('/t/rock_orm.png') },
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
  it('watches the texture, file maps (once each), the model and its files', () => {
    expect(watchedPaths(state)).toEqual(['/t/rock.png', '/t/rock_ao.png', '/t/rock_orm.png', '/t/rock.gltf', '/t/rock.bin'])
  })

  it('watches nothing when turned off, and skips files without a path', () => {
    expect(watchedPaths({ ...state, liveReload: false })).toEqual([])
    expect(watchedPaths({ liveReload: true, image: { name: 'a.png', width: 1, height: 1, version: 1 }, maps: {}, model: null })).toEqual([])
  })

  it('tells what a changed file is', () => {
    expect(changedRoles(state, '/t/rock.png')).toEqual({ texture: true, map: false, model: false })
    expect(changedRoles(state, '/t/rock_orm.png')).toEqual({ texture: false, map: true, model: false })
    expect(changedRoles(state, '/t/rock.bin')).toEqual({ texture: false, map: false, model: true })
    expect(changedRoles(state, '/t/other.png')).toEqual({ texture: false, map: false, model: false })
  })
})
