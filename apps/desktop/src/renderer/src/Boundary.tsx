import { Component, type ReactNode } from 'react'

/**
 * One piece of the window: a page, a pane, a message. If drawing it fails, the reader sees which
 * piece failed and why, and the rest of the window goes on working. Without this, one text that
 * cannot be drawn would leave the whole window blank.
 *
 * `of` is what the piece shows. When it changes, the piece is tried again.
 */
export class Boundary extends Component<{ what: string; of?: unknown; children: ReactNode }, { failed: Error | null; of: unknown }> {
  state = { failed: null as Error | null, of: this.props.of }

  static getDerivedStateFromError(failed: Error) {
    return { failed }
  }

  static getDerivedStateFromProps(props: { of?: unknown }, state: { of: unknown }) {
    return props.of === state.of ? null : { failed: null, of: props.of }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="broken" role="alert">
        <p>{this.props.what} could not be drawn.</p>
        <pre>{this.state.failed.message}</pre>
        <button onClick={() => this.setState({ failed: null })}>Try again</button>
      </div>
    )
  }
}
