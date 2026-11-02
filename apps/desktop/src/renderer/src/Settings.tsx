import { useEffect, useState } from 'react'
import type { AgentInfo, Settings as Held, Update } from './env'

const unwrapped = (caught: unknown) => String((caught as Error)?.message ?? caught).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Where the update of the installed app is, as main says it. */
function useUpdate(): Update {
  const [update, setUpdate] = useState<Update>({ state: 'idle' })
  useEffect(() => {
    void window.mate.update().then(setUpdate)
    return window.mate.onUpdate(setUpdate)
  }, [])
  return update
}

const updateSaid = (update: Update): string =>
  ({
    idle: '',
    checking: 'Checking…',
    none: 'This is the newest version.',
    downloading: 'Downloading the new version…',
    ready: `Mate ${update.version} is downloaded. It is put in when Mate quits.`,
    out: `Mate ${update.version} is out.`,
    failed: update.message ?? 'The check did not work.'
  })[update.state]

/** In the rail, when a new version is there to be put in. */
export function UpdateNotice() {
  const update = useUpdate()
  const [said, setSaid] = useState<string | null>(null)
  if (update.state !== 'ready' && update.state !== 'out') return null
  return (
    <footer className="rail-foot">
      <button className="quiet" onClick={() => window.mate.installUpdate().then(() => setSaid(null), (caught) => setSaid(unwrapped(caught)))}>
        {update.state === 'ready' ? 'Restart to update' : 'Download'}
      </button>
      <span className="meta" role="status" title={said ?? undefined}>
        {said ?? `Mate ${update.version}`}
      </span>
    </footer>
  )
}

/**
 * What the reader has set, in one place, and what this computer has. Kept in the app's data folder, so it
 * stays from one start to the next. From here a setting can only be taken away: trusting a context,
 * or letting an agent or the endpoint into a private one, is done in that context, behind a dialog of
 * the system.
 */
export function Settings(props: { onClose: () => void }) {
  const { onClose } = props
  const [held, setHeld] = useState<Held | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The endpoint form: address, model, and a key that is never shown back. Null until it is changed.
  const [editing, setEditing] = useState<{ url: string; model: string; key: string } | null>(null)
  const [saved, setSaved] = useState(false)
  // A forge being added: its address and a token, which is never shown back. While the forge is asked, and what it said.
  const [forge, setForge] = useState({ url: '', token: '' })
  const [forgeSaid, setForgeSaid] = useState<{ failed: boolean; text: string } | null>(null)
  // The editor command while it is changed. Null until then.
  const [editor, setEditor] = useState<string | null>(null)
  // The agents on this computer and the hosts added, what a look in the ssh config found (null until it is made), and a host typed by hand.
  const [added, setAdded] = useState<AgentInfo[]>([])
  const [looked, setLooked] = useState<AgentInfo[] | null>(null)
  const [hostName, setHostName] = useState('')
  const update = useUpdate()
  const mac = document.documentElement.dataset.platform === 'mac'
  useEffect(() => {
    void window.mate.listAgents().then((all) => setAdded(all.filter((each) => each.kind !== 'mcp')))
  }, [])
  const keepAgents = (all: AgentInfo[]) => setAdded(all)
  const isAdded = (each: AgentInfo) => added.some((one) => one.kind === each.kind && one.host === each.host)

  const load = () => window.mate.settings().then(setHeld, (caught) => setError(String(caught?.message ?? caught)))
  useEffect(() => {
    void load()
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  /** Run one change, then show the settings as they are now. */
  const act = (change: () => Promise<unknown>) => {
    setError(null)
    change().then(load, (caught) => setError(unwrapped(caught)))
  }
  const form = editing ?? { url: held?.endpoint?.url ?? '', model: held?.endpoint?.model ?? '', key: '' }
  const host = held?.endpoint ? new URL(held.endpoint.url).host : null

  return (
    <>
      <header className="bar">
        <span className="title"><strong>Settings</strong></span>
        <span className="acts">
          <button className="quiet" title="Esc" onClick={onClose}>
            Close
          </button>
        </span>
      </header>
      <div className="scroll">
        <div className="page settings">
          <h1>Settings</h1>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <section className="endpoint">
            <h2>Your endpoint</h2>
            <p className="meta">
              An inference server you control, with an OpenAI-compatible address. It can judge which passages answer a question in any context, and
              Hermes can work on it in a private context you open to it. The key is kept sealed by the keychain of this computer, and never shown again.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                act(async () => {
                  await window.mate.setEndpoint(form.url, form.model, form.key || undefined)
                  setEditing(null)
                  setSaved(true)
                })
              }}
            >
              <label>
                Address <input value={form.url} placeholder="https://your-server/v1" onChange={(event) => (setSaved(false), setEditing({ ...form, url: event.target.value }))} />
              </label>
              <label>
                Model <input value={form.model} placeholder="Qwen/Qwen3.6-35B-A3B-FP8" onChange={(event) => (setSaved(false), setEditing({ ...form, model: event.target.value }))} />
              </label>
              <label>
                Key{' '}
                <input
                  type="password"
                  value={form.key}
                  placeholder={held?.endpoint?.hasKey ? 'Saved. Leave empty to keep it.' : 'If the server asks for one'}
                  onChange={(event) => (setSaved(false), setEditing({ ...form, key: event.target.value }))}
                />
              </label>
              <p>
                <button type="submit" disabled={!editing}>
                  Save
                </button>
                {saved && host && <span className="meta"> Saved: {host}.</span>}
              </p>
              <p className="meta">A new host closes every private context that was open to the old one.</p>
            </form>
          </section>

          <section className="agents">
            <h2>Agents</h2>
            <p className="meta">
              Agents on this computer are found on their own. An agent on another machine is sent the text of your files, so Mate adds none:
              look in your ssh config and add the ones you want, or type a host.
            </p>
            <ul>
              {added.filter((each) => each.host === null).map((each) => (
                <li key={each.label}>
                  {each.label} <span className="meta">{each.found ? 'found' : 'not found'}</span>
                </li>
              ))}
            </ul>
            <h3>On other machines</h3>
            <ul className="remote">
              {added.filter((each) => each.host !== null).map((each) => (
                <li key={each.label}>
                  {each.label}
                  <button className="quiet" onClick={() => act(() => window.mate.removeAgent(each.kind, each.host!).then(keepAgents))}>
                    Remove
                  </button>
                </li>
              ))}
              {!added.some((each) => each.host !== null) && <li className="meta">None yet.</li>}
            </ul>
            <p>
              <button onClick={() => act(() => window.mate.discoverAgents().then(setLooked))}>Look in your ssh config</button>
            </p>
            {looked && (
              <ul>
                {looked.map((each) => (
                  <li key={each.label}>
                    {each.label}
                    <button
                      className="quiet"
                      disabled={isAdded(each)}
                      onClick={() => act(() => window.mate.addAgent(each.kind, each.host!).then(keepAgents))}
                    >
                      {isAdded(each) ? 'Added' : 'Add'}
                    </button>
                  </li>
                ))}
                {looked.length === 0 && <li className="meta">No hosts in your ssh config.</li>}
              </ul>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault()
                act(() => window.mate.addAgent('hermes', hostName.trim()).then((all) => (keepAgents(all), setHostName(''))))
              }}
            >
              <label>
                Hermes on another machine <input value={hostName} placeholder="host name, as ssh takes it" onChange={(event) => setHostName(event.target.value)} />
              </label>{' '}
              <button type="submit" disabled={!hostName.trim()}>
                Add
              </button>
            </form>
          </section>

          <section className="endpoint forges">
            <h2>Gitea and GitHub</h2>
            <p className="meta">
              A project that is a clone of a repository on your Gitea, GitHub or GitHub Enterprise has its pull requests in its menu. You check one
              out, comment on it as on any draft, and send your review, approve and merge from Mate. The forge shows them as yours. Mate asks only a
              forge you add here, and only when you press. The token is tried when you add it, then kept sealed by the keychain of this computer and
              never shown again. On Gitea it needs the scope write:repository. On GitHub, a fine-grained token needs Pull requests and Contents, read
              and write; a classic one, repo.
            </p>
            <ul>
              {held?.forges.map((each) => (
                <li key={each.url}>
                  <span className="dir">{each.url}</span>
                  <span className="meta">
                    {' '}
                    · {each.kind === 'github' ? 'GitHub' : 'Gitea'}
                    {each.user && `, as ${each.user}`}
                  </span>
                  <button className="quiet" onClick={() => act(() => window.mate.removeForge(each.url))}>
                    Remove
                  </button>
                </li>
              ))}
              {held && held.forges.length === 0 && <li className="meta">None yet.</li>}
            </ul>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                // Said here, under the form: the forge can take a while, and a refusal at the top of the page is out of sight.
                setForgeSaid({ failed: false, text: 'Trying the token…' })
                window.mate.addForge(forge.url, forge.token).then(
                  () => (setForge({ url: '', token: '' }), setForgeSaid(null), void load()),
                  (caught) => setForgeSaid({ failed: true, text: unwrapped(caught) })
                )
              }}
            >
              <label>
                Address <input value={forge.url} placeholder="https://git.example.org, or https://github.com" onChange={(event) => setForge({ ...forge, url: event.target.value })} />
              </label>
              <label>
                Token <input type="password" value={forge.token} placeholder="Made in the forge's settings, for you" onChange={(event) => setForge({ ...forge, token: event.target.value })} />
              </label>
              <p>
                <button type="submit" disabled={!forge.url.trim() || !forge.token.trim() || forgeSaid?.failed === false}>
                  Add
                </button>
              </p>
              {forgeSaid && (
                <p className={forgeSaid.failed ? 'error' : 'meta'} role={forgeSaid.failed ? 'alert' : 'status'}>
                  {forgeSaid.text}
                </p>
              )}
              <p className="meta">A forge added again with a new token keeps only the new one.</p>
            </form>
          </section>

          <section className="endpoint">
            <h2>Your editor</h2>
            <p className="meta">
              Open in editor opens a file there, at the line of the comment or the selection. Give the command and what it takes before the file, such
              as <code>code -g</code> for VS Code, Cursor or Zed: the file goes last, as <code>FILE:LINE</code>. Left empty, the system's own app for the
              file opens it, at its top.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (editor !== null) act(() => window.mate.setEditor(editor).then(() => setEditor(null)))
              }}
            >
              <label>
                Command <input value={editor ?? held?.editor ?? ''} placeholder="code -g" onChange={(event) => setEditor(event.target.value)} />
              </label>
              <p>
                <button type="submit" disabled={editor === null}>
                  Save
                </button>
              </p>
            </form>
          </section>

          <section className="notifications">
            <h2>Notifications</h2>
            <p className="meta">
              When Mate is not what you are looking at, the system tells you that an agent has finished, has a plan to approve, is asking you something,
              or wants to change a file, and that a new version is ready. It names the agent and the project and nothing from a document.
            </p>
            <label>
              <input type="checkbox" checked={held?.notifications ?? true} onChange={(event) => act(() => window.mate.setNotifications(event.target.checked))} /> Tell me
            </label>
          </section>

          <section className="updates">
            <h2>Updates</h2>
            <p className="meta">
              This is Mate {held?.version}. The installed app asks GitHub for a newer version when it starts and every six hours. It sends nothing of
              your contexts.{' '}
              {mac ? 'A new version is downloaded, and put in when Mate quits.' : 'When there is one, it says so, and opens the page to download it from.'}
            </p>
            <p>
              <button disabled={update.state === 'checking' || update.state === 'downloading'} onClick={() => act(() => window.mate.checkForUpdate())}>
                Check now
              </button>{' '}
              {(update.state === 'ready' || update.state === 'out') && (
                <button onClick={() => act(() => window.mate.installUpdate())}>{update.state === 'ready' ? 'Restart to update' : 'Download'}</button>
              )}{' '}
              <span className="meta" role="status">
                {updateSaid(update)}
              </span>
            </p>
          </section>

          <section>
            <h2>Contexts you trust</h2>
            <p className="meta">In these, Hermes runs as it does in your terminal, and scripts and commits run. You trust a context in its Agent tab.</p>
            {held && held.trusted.length === 0 && <p className="meta">None.</p>}
            <ul>
              {held?.trusted.map((dir) => (
                <li key={dir}>
                  <span className="dir">{dir}</span>
                  <button className="quiet" onClick={() => act(() => window.mate.untrust(dir))}>
                    Stop trusting
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Private contexts</h2>
            <p className="meta">No agent works in these, so nothing of them leaves this computer, unless one is open to your endpoint. You make a context private, or let agents in again, in its Agent tab.</p>
            {held && held.private.length === 0 && <p className="meta">None.</p>}
            <ul>
              {held?.private.map(({ dir, opened }) => (
                <li key={dir}>
                  <span className="dir">{dir}</span>
                  {opened && <span className="meta"> · open to {host ?? 'your endpoint'}</span>}
                  {opened && (
                    <button className="quiet" onClick={() => act(() => window.mate.closeToEndpoint(dir))}>
                      Close it to your endpoint
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>On this computer</h2>
            <ul>
              <li>
                Search by meaning: <span className="meta">{held ? (held.meaning ?? 'ready, with bge-m3 in Ollama on this computer.') : '…'}</span>
              </li>
              <li>
                Drafting in the comment box:{' '}
                <span className="meta">
                  {!held
                    ? '…'
                    : held.assist.available
                      ? `ready, with ${document.documentElement.dataset.platform === 'mac' ? "Apple's model" : 'Ollama'} on this computer.`
                      : held.assist.present
                        ? held.assist.reason || 'not available.'
                        : 'the helper is not built.'}
                </span>
              </li>
              <li>
                Settings are kept in <span className="dir">{held?.folder}</span>
                <button className="quiet" onClick={() => act(() => window.mate.revealSettings())}>
                  {document.documentElement.dataset.platform === 'mac' ? 'Show in Finder' : 'Show the folder'}
                </button>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </>
  )
}
