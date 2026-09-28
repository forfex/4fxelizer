import { Component, type ReactNode } from 'react'

interface Props {
  /** Shown instead of the children after they throw; `retry` renders them again. */
  fallback(error: string, retry: () => void): ReactNode
  children: ReactNode
}

/** Keeps a render error in one part of the window from unmounting the whole app. */
export class ErrorBoundary extends Component<Props, { error: string | null }> {
  state = { error: null as string | null }

  static getDerivedStateFromError(e: unknown): { error: string } {
    return { error: e instanceof Error ? e.message : String(e) }
  }

  componentDidCatch(e: unknown): void {
    console.error(e)
  }

  render(): ReactNode {
    return this.state.error !== null
      ? this.props.fallback(this.state.error, () => this.setState({ error: null }))
      : this.props.children
  }
}
