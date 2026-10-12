/**
 * The files of the open project, as folders that fold. `paths` are counted from the project
 * folder. Mate draws markdown and nothing else, so any other file is named and cannot be opened.
 */
export function Tree(props: { paths: string[]; base?: string; current: string | null; onOpen: (path: string) => void }) {
  const { paths, base = '', current, onOpen } = props
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
                className={current === full ? 'row active' : 'row'}
                disabled={!markdown}
                title={markdown ? undefined : 'Not markdown. Mate does not open it.'}
                onClick={() => onOpen(full)}
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
              <Tree paths={paths.filter((each) => each.startsWith(`${full}/`))} base={`${full}/`} current={current} onOpen={onOpen} />
            </details>
          </li>
        )
      })}
    </ul>
  )
}
