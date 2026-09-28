import { useApp } from '@/store'
import { Led } from './ui/retro'

/** Bottom strip: an LED and the latest message, then LCD cells for the cursor and image size. */
export function StatusBar() {
  const message = useApp((s) => s.message)
  const cursor = useApp((s) => s.cursor)
  const image = useApp((s) => s.image)

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t-px border-edge bg-panel px-2 text-small shadow-[inset_0_var(--px)_0_var(--fx-bevel-light)]">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Led state={message?.kind === 'error' ? 'error' : message ? 'on' : 'off'} />
        <span className={message?.kind === 'error' ? 'truncate text-led-error' : 'truncate text-dim'}>{message?.text ?? 'Ready'}</span>
      </div>
      <Cell label="X,Y">{cursor ? `${cursor.x}, ${cursor.y}` : '—'}</Cell>
      <Cell label="Size">{image ? `${image.width} × ${image.height}` : '—'}</Cell>
    </footer>
  )
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="bevel-sunken flex h-4.5 min-w-28 shrink-0 items-center gap-1.5 rounded-[2px] bg-lcd px-1.5">
      <span className="text-dim">{label}</span>
      <span className="ml-auto font-mono text-[10px] leading-3.5 text-lcd-text tabular-nums">{children}</span>
    </span>
  )
}
