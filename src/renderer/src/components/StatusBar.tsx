import { useApp } from '@/store'
import { Led } from './ui/retro'

export function StatusBar() {
  const message = useApp((s) => s.message)
  const cursor = useApp((s) => s.cursor)
  const image = useApp((s) => s.image)

  return (
    <footer className="bevel-raised flex h-6 shrink-0 items-center gap-3 bg-panel px-2 text-small">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {message && <Led state={message.kind === 'error' ? 'error' : 'on'} />}
        <span className={message?.kind === 'error' ? 'truncate text-led-error' : 'truncate text-dim'}>
          {message?.text ?? 'Ready'}
        </span>
      </div>
      <Field label="X,Y">{cursor ? `${cursor.x}, ${cursor.y}` : '—'}</Field>
      <Field label="Size">{image ? `${image.width} × ${image.height}` : '—'}</Field>
    </footer>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="bevel-sunken flex h-4.5 min-w-28 items-center gap-1.5 px-1.5">
      <span className="text-dim">{label}</span>
      <span className="font-mono tabular-nums">{children}</span>
    </span>
  )
}
