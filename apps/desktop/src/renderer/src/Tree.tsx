import type { DragEvent } from 'react'
import { isTwinned } from '../../shared/twin'

/** What a row carries when it is dragged: its path from the project. */
export const MOVE = 'text/x-mate-path'

/**
 * The files of the open project, as folders that fold. `paths` are counted from the project
 * folder. Mate draws markdown and nothing else. Any other file is shown where it lies on the
 * computer, for the reader to open with what they have.
 */
export function Tree(props: {
  paths: string[]
  /** Folders with nothing in them show too, so a folder the reader just made is there. */
  folders?: string[]
  base?: string
  current: string | null
  onOpen: (path: string) => void
  onReveal: (path: string) => void
  /** The folder that starts unfolded: in a project, its drafts. */
  unfolded?: string
  /** A file or a folder is dropped on a folder. `to` is empty for the project itself. With this, the rows can be dragged. */
  onMove?: (from: string, to: string) => void
  /** A draft is to be started in this folder. With this, a folder of the drafts has a plus. `draftsIn` is where the drafts are. */
  onNewDraft?: (folder: string) => void
  draftsIn?: string
  /** Files that say they are final, by their path from the project. */
  final?: string[]
}) {
  const { paths, folders = [], base = '', current, onOpen, onReveal, unfolded = 'draft', onMove, onNewDraft, draftsIn = 'draft/', final = [] } = props
  const manager = document.documentElement.dataset.platform === 'mac' ? 'Finder' : 'the file manager'
  const isFile = (name: string) => paths.includes(base + name)
  // What is directly in this folder: a file, or the folder that something deeper is in.
  const here = [...new Set([...paths, ...folders].map((each) => each.slice(base.length).split('/')[0]))]
  // What a project keeps for itself stays where it is. A comment file or a note moves with its file.
  const kept = (full: string) => ['draft', 'dropbox', 'panes', 'scripts', 'intents.md', 'principles.md'].includes(full) || /\.(comments|notes)\.md$/i.test(full)
  const drag = (full: string) =>
    onMove && !kept(full) ? { draggable: true, onDragStart: (event: DragEvent) => (event.dataTransfer.setData(MOVE, full), (event.dataTransfer.effectAllowed = 'move')) } : {}
  here.sort((a, b) => Number(isFile(a)) - Number(isFile(b)) || a.localeCompare(b))
  return (
    <ul className="tree">
      {here.map((name) => {
        const full = base + name
        if (isFile(name)) {
          const markdown = name.toLowerCase().endsWith('.md')
          return (
            <li key={name}>
              <button
                {...drag(full)}
                className={`${current === full ? 'row active' : markdown || isTwinned(name) ? 'row' : 'row other'}${final.includes(full) ? ' final' : ''}`}
                title={final.includes(full) ? 'Final: the finished document of this project' : markdown ? undefined : isTwinned(name) ? 'Mate reads its text.' : `A file of text opens to be reviewed, its comments kept beside it. Any other is shown with what can be done with it, or in ${manager}.`}
                onClick={() => (markdown ? onOpen(full) : onReveal(full))}
              >
                {name}
              </button>
            </li>
          )
        }
        return (
          <li key={name}>
            {/* The draft is what the project is for, so its folder starts unfolded. The reader folds the rest. */}
            {/* Unfolded too when the file on the page is in it, so the reader sees where it is. */}
            <details open={full === unfolded || (current?.startsWith(`${full}/`) ?? false)}>
              <summary
                {...drag(full)}
                {...(onMove && !['panes', 'scripts'].includes(full.split('/')[0]) ? dropOn(full, onMove) : {})}
              >
                {name}
                {onNewDraft && (draftsIn === '' ? !['dropbox', 'panes', 'scripts'].includes(full.split('/')[0]) : full === draftsIn.slice(0, -1) || full.startsWith(draftsIn)) && (
                  <button
                    className="add"
                    title={`A new draft in ${name}`}
                    aria-label={`A new draft in ${name}`}
                    onClick={(event) => (event.preventDefault(), event.stopPropagation(), onNewDraft(full.slice(draftsIn.length)))}
                  >
                    +
                  </button>
                )}
              </summary>
              <Tree paths={paths.filter((each) => each.startsWith(`${full}/`))} folders={folders.filter((each) => each.startsWith(`${full}/`))} base={`${full}/`} current={current} onOpen={onOpen} onReveal={onReveal} unfolded={unfolded} onMove={onMove} onNewDraft={onNewDraft} draftsIn={draftsIn} final={final} />
            </details>
          </li>
        )
      })}
    </ul>
  )
}

/** What a place that takes a dropped row does: it says so while a row is over it, and gives the path of the row that fell. */
export function dropOn(to: string, onMove: (from: string, to: string) => void) {
  return {
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(MOVE)) return
      event.preventDefault()
      event.currentTarget.classList.add('over')
    },
    onDragLeave: (event: DragEvent) => event.currentTarget.classList.remove('over'),
    onDrop: (event: DragEvent) => {
      event.currentTarget.classList.remove('over')
      const from = event.dataTransfer.getData(MOVE)
      if (!from) return
      event.preventDefault()
      event.stopPropagation()
      onMove(from, to)
    }
  }
}
