import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileWatcher } from './watch'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Waits until `check` passes or the time runs out (file events take a moment). */
async function eventually(check: () => void, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  for (;;) {
    try {
      check()
      return
    } catch (e) {
      if (Date.now() > end) throw e
      await sleep(50)
    }
  }
}

describe('FileWatcher', () => {
  let dir = ''
  let watcher: FileWatcher | null = null

  afterEach(async () => {
    watcher?.dispose()
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('reports a watched file once it changes, also when saved by renaming over it', async () => {
    dir = await mkdtemp(join(tmpdir(), 'fx-watch-'))
    const file = join(dir, 'rock.png')
    const other = join(dir, 'other.png')
    await writeFile(file, 'one')
    await writeFile(other, 'x')
    const changed: string[] = []
    watcher = new FileWatcher((p) => changed.push(p))
    await watcher.set([file])
    expect(watcher.has(file)).toBe(true)
    expect(watcher.has(other)).toBe(false)

    await writeFile(other, 'changed') // not watched
    await writeFile(file, 'two!')
    await eventually(() => expect(changed).toEqual([file]))

    await writeFile(join(dir, 'rock.tmp'), 'three!!')
    await rename(join(dir, 'rock.tmp'), file)
    await eventually(() => expect(changed).toEqual([file, file]))
  })

  it('stops reporting a file once it is no longer watched, and ignores relative paths', async () => {
    dir = await mkdtemp(join(tmpdir(), 'fx-watch-'))
    const file = join(dir, 'rock.png')
    await writeFile(file, 'one')
    const changed: string[] = []
    watcher = new FileWatcher((p) => changed.push(p))
    await watcher.set([file, 'relative.png', 7])
    expect(watcher.has('relative.png')).toBe(false)
    await watcher.set([])
    expect(watcher.has(file)).toBe(false)
    await writeFile(file, 'two!')
    await sleep(600)
    expect(changed).toEqual([])
  })
})
