# Mate desktop

The Electron app. It is the only application in this repository; the rules
it follows are in [../../docs/model.md](../../docs/model.md).

## Running it

From the repository root:

```sh
pnpm install
pnpm dev
```

Or from this folder: `pnpm dev`, `pnpm test`, `pnpm test:e2e`,
`pnpm typecheck`, `pnpm build`, `pnpm build:assist`, `pnpm pack:mac`,
`pnpm dist:mac`, `pnpm pack:linux`, `pnpm dist:linux`.

A folder named on the command line is opened as the context, with no
folder dialog: `electron . path/to/context` in this folder, after
`pnpm build`.

`pnpm dev` runs `electron-vite dev`, which starts a Vite server for the
window and launches Electron. If the window opens blank, check that
`out/preload/index.cjs` exists after a build: the window loads the preload
from there.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MATE_MCP_PORT` | `41757` | Port of the local MCP endpoint. If it is taken, Mate picks a free one and shows the address. |
| `MATE_ASSIST` | `assist/mate-assist`, or the app's resources when it is installed | macOS. Path to the on-device helper. Set it to point at another build. |
| `MATE_OLLAMA_MODEL` | `qwen2.5:3b` | Linux. The local Ollama chat model used for writing assist. |
| `MATE_LINUX_RELAY` | `assist/linux-relay.py`, or the app's resources | Linux. Path to the Python bridge used inside Bubblewrap for private Hermes sessions. |
| `ELECTRON_RENDERER_URL` | set by `pnpm dev` | Address of the Vite server in development. Do not set it by hand. |
| `REMOTE_DEBUGGING_PORT`, `V8_INSPECTOR_PORT` | unset | Optional. Chrome DevTools and Node inspector ports, for debugging. |

If `pnpm dev` exits with `The requested module 'electron' does not provide
an export named 'BrowserWindow'`, the shell has `ELECTRON_RUN_AS_NODE` set.
Unset it (`env -u ELECTRON_RUN_AS_NODE pnpm dev`).

## Layout

```
src/
  main/
    index.ts        app lifecycle, windows, menu, every IPC handler
    context.ts      reading projects and drafts; the one path that writes a draft
    contextIndex.ts the search index and ranking
    agents.ts       how each agent is started and its output is read; SSH
    guard.ts        snapshots of the context and what changed in it
    sessions.ts     conversations, turns, the rule for each change (judge)
    mcp.ts          the local MCP endpoint and its tools
    assist.ts       questions for the on-device helper or Linux Ollama model
    endpoint.ts     the reader's inference endpoint, relay and private-agent sandbox
    trust.ts        the contexts the reader trusts
    acp.ts          an agent that stays: asks, takes a message mid-turn, is told a model
    pins.ts         the instruction files the reader approved
    scripts.ts      runs a script of a project, with no agent
    git.ts          starts a repository, and commits what changed in the context
    twins.ts        the text of PDF and Word files, kept for search and reading
    meaning.ts      search by meaning: passages, vectors from Ollama's bge-m3
  preload/
    index.ts        window.mate: the only bridge from the window to main
  renderer/src/
    App.tsx         the window: rail, page, margin
    Rendered.tsx    draws the markdown and the highlights
    Agent.tsx       the Agent tab: sessions, the conversation, the model and the effort
    Question.tsx    whole-context questions and nearby passages
    Settings.tsx    endpoint, trust, privacy and local model settings
    Palette.tsx     Command/Ctrl+K: what the window can go to or do, found by typing
    Boundary.tsx    keeps the window working when one piece cannot be drawn
    Tree.tsx        the files of the open project, in the rail
    markdown.ts     the markdown tree; every character appears once, in order
    styles.css      the look, light and dark
    env.d.ts        the types of window.mate, shared by both sides
  shared/
    comments.ts     the comment marker: parse, insert, reply, apply, anchor, retype
    diff.ts         two texts compared line by line
    run.ts          what a run button leaves open, and how it is filled
    named.ts        which file of a project some words name
    twin.ts         which files have a text twin, and where it is
    effort.ts       the steps of thinking effort
assist/
  main.swift        the on-device helper: one question in, one answer out
  linux-relay.py    the loopback-to-Unix bridge inside Bubblewrap
build/
  icon.svg          the drawing of the app's icon
  icon.mjs          draws icon.icns and icon.png from it (`pnpm icon`)
electron-builder.yml  how the app is put together to be installed
tests/              node:test unit tests, run with --experimental-strip-types
  e2e/              the built app, driven through its window
```

What the app keeps outside any context is in its own data folder (on
macOS, `~/Library/Application Support/Mate/`; on Linux, `~/.config/Mate/`): `trusted.json`, the
contexts the reader trusts; `pins.json`, the instruction files they
approved; `mcp-token`, the token of the local MCP endpoint. Nothing in a
context can change these.

Run from a checkout, the app is called Mate Dev and keeps its data in a
folder of that name beside the other. A checkout can be driven through a
debugging port, so it does not share the trust, the approvals or the
token of the app that is installed. A context you trusted in one is not
trusted in the other.

## Testing

`pnpm test` runs every `tests/*.test.ts` file. The tests use real files in
a temporary folder, and stand-ins for the agent commands (small scripts
that print what the real tool prints). They do not start Electron.

`pnpm test:e2e` runs `tests/e2e/*.e2e.ts`. It builds the app, starts it
on a copy of `contexts/_example` with a data folder of its own, and drives
the window: a comment into the file, the tree, a pane, the conversation
on the page, a project started from the rail, a git repository started
for the context and a commit refused there, and, in a context marked as
trusted for the test, a script run from its button and a commit made.
The git steps need `git` on the PATH. There is no test framework. `tests/e2e/drive.ts` asks
Electron for a debugging port and speaks to the page over it with what
Node has. Clicks are made in the page and not with the mouse, so the test
works while its window is covered. It starts no agent.

## Building

`pnpm build` writes `out/main`, `out/preload`, and `out/renderer`.

## An app to install

For Apple silicon macOS and x86-64 Linux. `electron-builder.yml` is the
whole of it, and `electron-builder` is a development dependency: nothing
of it is in the app.

| Command | What it makes |
|---|---|
| `pnpm pack:mac` | `release/mac-arm64/Mate.app`, to try. It takes no certificate from the keychain, so it runs on this Mac and is not for anyone else. |
| `pnpm dist:mac` | `release/Mate-<version>-arm64.dmg`, signed with the Developer ID Application certificate in the keychain. |
| `pnpm pack:linux` | `release/linux-unpacked/mate`, to try on this computer. |
| `pnpm dist:linux` | `release/Mate-<version>-x86_64.AppImage` and `release/Mate-<version>-amd64.deb`, unsigned. |

Both Mac commands build the on-device helper first, so they need the Xcode
command line tools. Linux does not use the helper. `release/` is not committed.

Linux packages contain none of the optional external tools. Poppler reads
PDFs, Tesseract reads scans, LibreOffice converts Office documents, and
Python 3 reads web archives; they must be on `PATH`. Linux writing assist
uses Ollama with the model named by `MATE_OLLAMA_MODEL`. Private Hermes
sessions also need Bubblewrap and Python 3; only the small Python bridge
is packaged. See the root README for installation commands.

`pnpm dist:mac` sends the app to Apple to be notarised only when the
credentials are in the environment: `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`, or
`APPLE_KEYCHAIN_PROFILE` for a profile stored with `notarytool`. Without
them it signs and says that it did not notarise. If the keychain holds
more than one certificate, name the one to use in `CSC_NAME`.

What is in the app: the built `out/` folder in one archive, `package.json`,
the helper beside it in the resources on a Mac, and the icon. Nothing is
loaded from `node_modules` when it runs.

An installed app differs from a checkout in three ways, all on purpose:

- It does not act as Node, and takes no Node options and no inspector
  from outside. These are switched off in the program itself.
- It refuses a debugging port. The end-to-end test drives a checkout, not
  the installed app.
- It fetches no update. A new version is a new download.

It keeps its data in a folder of its own (on macOS,
`~/Library/Application Support/Mate/`; on Linux, `~/.config/Mate/`).
`pnpm dev` uses another: see "Layout" above.

A tag `vX.Y.Z` on `main` builds and publishes the disk image, AppImage and
Debian package on GitHub: see "Continuous integration and releases" in
[../../CONTRIBUTING.md](../../CONTRIBUTING.md). Locally, `pnpm dist:mac`
and `pnpm dist:linux` do the same without the publishing.

`pnpm icon` draws `build/icon.icns` and `build/icon.png` again from
`build/icon.svg`. Run it when the drawing changes, and commit the icons.

If `pnpm dev` stops finding Electron after a dependency was added, see
the repair steps in [../../docs/mvp.md](../../docs/mvp.md).
