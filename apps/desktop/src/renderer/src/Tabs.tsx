import { Icon } from './Icon'

/** The name a tab shows: the file's name, and its folder too when another tab has the same name. */
function nameOf(path: string, all: string[]): string {
  const parts = path.split('/')
  const name = parts[parts.length - 1]
  const same = all.filter((each) => each !== path && each.split('/').pop() === name)
  return same.length > 0 && parts.length > 1 ? `${parts[parts.length - 2]}/${name}` : name
}

/** The files the reader has open in this project, one tab each. Opening a file adds one; the cross takes it away. */
export function Tabs(props: { paths: string[]; current: string | null; onOpen: (path: string) => void; onClose: (path: string) => void }) {
  const { paths, current, onOpen, onClose } = props
  if (paths.length < 2) return null
  return (
    <div className="doc-tabs" role="tablist" aria-label="Open files">
      {paths.map((path) => (
        <span key={path} className={path === current ? 'doc-tab active' : 'doc-tab'} onAuxClick={(event) => event.button === 1 && onClose(path)}>
          <button role="tab" aria-selected={path === current} title={path} onClick={() => onOpen(path)}>
            {nameOf(path, paths)}
          </button>
          <button className="close" aria-label={`Close ${path.split('/').pop()}`} title="Close" onClick={() => onClose(path)}>
            <Icon name="close" size={12} />
          </button>
        </span>
      ))}
    </div>
  )
}
