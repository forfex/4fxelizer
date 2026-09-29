import { describe, expect, it } from 'vitest'
import { parseNotes, parseSpans } from './releaseNotes'

describe('release notes', () => {
  it('reads headings, list items and paragraphs', () => {
    expect(parseNotes('Intro line\nsecond line\n\n## What\'s new\n- One\n* Two\n\nEnd')).toEqual([
      { kind: 'paragraph', spans: [{ text: 'Intro line second line' }] },
      { kind: 'heading', spans: [{ text: "What's new" }] },
      { kind: 'item', spans: [{ text: 'One' }], level: 0 },
      { kind: 'item', spans: [{ text: 'Two' }], level: 0 },
      { kind: 'paragraph', spans: [{ text: 'End' }] }
    ])
  })

  it('nests indented list items', () => {
    expect(parseNotes('- Added\n  - one\n\t* two\n- Next').map((b) => [b.spans[0]!.text, b.level])).toEqual([
      ['Added', 0],
      ['one', 1],
      ['two', 1],
      ['Next', 0]
    ])
  })

  it('finds bold and code spans and keeps link text', () => {
    expect(parseSpans('Open **several** files as `.pxproj` via [the menu](https://x.y)')).toEqual([
      { text: 'Open ' },
      { text: 'several', bold: true },
      { text: ' files as ' },
      { text: '.pxproj', code: true },
      { text: ' via the menu' }
    ])
  })
})
