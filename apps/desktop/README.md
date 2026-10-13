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
`pnpm dist:mac`.

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
| `MATE_ASSIST` | `assist/mate-assist`, or the app's resources when it is installed | Path to the on-device helper. Set it to point at another build. |
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
    assist.ts       questions for the on-device helper
    trust.ts        the contexts the reader trusts
    acp.ts          an agent that stays: asks, takes a message mid-turn, is told a model
    pins.ts         the instruction files the reader approved
    scripts.ts      runs a script of a project, with no agent
  preload/
    index.ts        window.mate: the only bridge from the window to main
  renderer/src/
    App.tsx         the window: rail, page, margin
    Rendered.tsx    draws the markdown and the highlights
    Agent.tsx       the Agent tab: sessions, the conversation, the model and the effort
    Tree.tsx        the files of the open project, in the rail
    markdown.ts     the markdown tree; every character appears once, in order
    styles.css      the look, light and dark
    env.d.ts        the types of window.mate, shared by both sides
  shared/
    comments.ts     the comment marker: parse, insert, reply, apply, anchor, retype
    diff.ts         two texts compared line by line
    run.ts          what a run button leaves open, and how it is filled
    effort.ts       the steps of thinking effort
assist/
  main.swift        the on-device helper: one question in, one answer out
build/
  icon.svg          the drawing of the app's icon
  icon.mjs          draws icon.icns from it (`pnpm icon`)
electron-builder.yml  how the app is put together to be installed
tests/              node:test unit tests, run with --experimental-strip-types
  e2e/              the built app, driven through its window
```

What the app keeps outside any context is in its own data folder (on
macOS, `~/Library/Application Support/Mate/`): `trusted.json`, the
contexts the reader trusts; `pins.json`, the instruction files they
approved; `mcp-token`, the token of the local MCP endpoint. Nothing in a
context can change these.

## Testing

`pnpm test` runs every `tests/*.test.ts` file. The tests use real files in
a temporary folder, and stand-ins for the agent commands (small scripts
that print what the real tool prints). They do not start Electron.

`pnpm test:e2e` runs `tests/e2e/*.e2e.ts`. It builds the app, starts it
on a copy of `contexts/_example` with a data folder of its own, and drives
the window: a comment into the file, the tree, a pane, the conversation
on the page, a project started from the rail, and, in a context marked as
trusted for the test, a script run from its button. There is no test framework. `tests/e2e/drive.ts` asks
Electron for a debugging port and speaks to the page over it with what
Node has. Clicks are made in the page and not with the mouse, so the test
works while its window is covered. It starts no agent.

## Building

`pnpm build` writes `out/main`, `out/preload`, and `out/renderer`.

## An app to install

Mac only so far, for Apple silicon. `electron-builder.yml` is the whole
of it, and `electron-builder` is a development dependency: nothing of it
is in the app.

| Command | What it makes |
|---|---|
| `pnpm pack:mac` | `release/mac-arm64/Mate.app`, to try. It takes no certificate from the keychain, so it runs on this Mac and is not for anyone else. |
| `pnpm dist:mac` | `release/Mate-<version>-arm64.dmg`, signed with the Developer ID Application certificate in the keychain. |

Both build the on-device helper first, so they need the Xcode command
line tools. `release/` is not committed.

`pnpm dist:mac` sends the app to Apple to be notarised only when the
credentials are in the environment: `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`, or
`APPLE_KEYCHAIN_PROFILE` for a profile stored with `notarytool`. Without
them it signs and says that it did not notarise. If the keychain holds
more than one certificate, name the one to use in `CSC_NAME`.

What is in the app: the built `out/` folder in one archive, `package.json`,
the helper beside it in the resources, and the icon. Nothing is loaded
from `node_modules` when it runs.

An installed app differs from a checkout in three ways, all on purpose:

- It does not act as Node, and takes no Node options and no inspector
  from outside. These are switched off in the program itself.
- It refuses a debugging port. The end-to-end test drives a checkout, not
  the installed app.
- It fetches no update. A new version is a new disk image.

It keeps its data where `pnpm dev` does (on macOS,
`~/Library/Application Support/Mate/`), so the contexts you trusted in
one are trusted in the other.

`pnpm icon` draws `build/icon.icns` again from `build/icon.svg`. Run it
when the drawing changes, and commit both.

If `pnpm dev` stops finding Electron after a dependency was added, see
the repair steps in [../../docs/mvp.md](../../docs/mvp.md).
