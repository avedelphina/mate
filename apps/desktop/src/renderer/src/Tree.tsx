/**
 * The files of the open project, as folders that fold. `paths` are counted from the project
 * folder. Mate draws markdown and nothing else. Any other file is shown where it lies on the
 * computer, for the reader to open with what they have.
 */
export function Tree(props: {
  paths: string[]
  base?: string
  current: string | null
  onOpen: (path: string) => void
  onReveal: (path: string) => void
}) {
  const { paths, base = '', current, onOpen, onReveal } = props
  const manager = document.documentElement.dataset.platform === 'mac' ? 'Finder' : 'the file manager'
  const isFile = (name: string) => paths.includes(base + name)
  // What is directly in this folder: a file, or the folder that something deeper is in.
  const here = [...new Set(paths.map((each) => each.slice(base.length).split('/')[0]))]
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
                className={current === full ? 'row active' : markdown ? 'row' : 'row other'}
                title={markdown ? undefined : `Not markdown, so Mate does not draw it. Click to show it in ${manager}.`}
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
            <details open={full === 'draft'}>
              <summary>{name}</summary>
              <Tree paths={paths.filter((each) => each.startsWith(`${full}/`))} base={`${full}/`} current={current} onOpen={onOpen} onReveal={onReveal} />
            </details>
          </li>
        )
      })}
    </ul>
  )
}
