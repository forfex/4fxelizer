// Release notes (GitHub markdown) as a few simple blocks for the update window: headings, list
// items and paragraphs, with bold and code spans. Anything fancier shows as plain text.

export interface Span {
  text: string
  bold?: boolean
  code?: boolean
}

export interface NotesBlock {
  kind: 'heading' | 'item' | 'paragraph'
  spans: Span[]
}

/** `**bold**` and `` `code` `` spans; links keep their text. */
export function parseSpans(line: string): Span[] {
  const text = line.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
  const spans: Span[] = []
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`/g
  let last = 0
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index) })
    spans.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2]!, code: true })
    last = m.index + m[0].length
  }
  if (last < text.length) spans.push({ text: text.slice(last) })
  return spans
}

export function parseNotes(markdown: string): NotesBlock[] {
  const blocks: NotesBlock[] = []
  let paragraph: string[] = []
  const flush = (): void => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', spans: parseSpans(paragraph.join(' ')) })
    paragraph = []
  }
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const item = /^[-*+]\s+(.*)$/.exec(line)
    if (!line) flush()
    else if (heading) {
      flush()
      blocks.push({ kind: 'heading', spans: parseSpans(heading[1]!) })
    } else if (item) {
      flush()
      blocks.push({ kind: 'item', spans: parseSpans(item[1]!) })
    } else paragraph.push(line)
  }
  flush()
  return blocks
}
