# Contributing to Mate

Thank you for looking at Mate. This file says how to build it, how it is
organised, and what kind of change fits.

Please also read the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

Mate is deliberately small. Read these first, because most "missing"
features are later steps in the roadmap or are out of scope on purpose:

- [docs/model.md](docs/model.md): the rules. The file is the document; Mate keeps no copy.
- [docs/roadmap.md](docs/roadmap.md): the order things are built in. Do not start a later step because it looks small.
- [docs/architecture.md](docs/architecture.md): where a change goes.

If you want to add something that is not on the roadmap, open an issue
first and describe the problem. A change that adds a database, a server,
accounts, or a second copy of a document will not be merged.

## Setting up

Requirements: Node.js 22 or newer and pnpm 10 or newer.

```sh
pnpm install
pnpm test        # unit tests
pnpm test:e2e    # builds the app and drives its window (a window opens)
pnpm typecheck   # TypeScript, both configs: main with preload, and the window
pnpm build       # electron-vite build into apps/desktop/out/
pnpm dev         # run the app
```

Run the tests, the type check and the build before you open a pull
request. The project has no CI yet, so these are run by hand.

On macOS with Xcode, `pnpm build:assist` also builds the on-device helper.
It is optional and not needed for any test.

## Layout

```
apps/desktop/
  src/main/          Electron main process: files, comments, index, agents, MCP
  src/preload/       the one bridge between window and main (window.mate)
  src/renderer/      the React window
  src/shared/        code both sides use: the comment marker, the line diff, run buttons
  assist/            the Swift helper for the on-device model
  tests/             unit tests, run with node --test
  tests/e2e/         the built app, driven through its window
contexts/_example/   a sample context, safe to open and edit
docs/                the rules, the design, the roadmap
```

Where a change goes:

| Change | Start in |
|---|---|
| The comment marker format | `apps/desktop/src/shared/comments.ts` |
| Reading or writing a draft, publishing, the dropbox | `apps/desktop/src/main/context.ts` |
| Panes, and what the reader can press in one | `src/main/context.ts`, then `src/renderer/src/Rendered.tsx` |
| Running a script of a project | `src/main/scripts.ts` |
| A new capability for the window | `src/main/index.ts`, then `src/preload/index.ts`, then `src/renderer/src/env.d.ts` |
| How markdown is drawn | `src/renderer/src/markdown.ts` |
| Search and the index | `src/main/contextIndex.ts` |
| What an agent may change | `src/main/guard.ts`, `src/main/sessions.ts` (`judge`) |
| Agents on this computer and over SSH | `src/main/agents.ts` |
| An agent that stays between turns | `src/main/acp.ts` |
| Trusted contexts, and approved instruction files | `src/main/trust.ts`, `src/main/pins.ts` |
| The MCP endpoint | `src/main/mcp.ts` |

The full table is in [docs/architecture.md](docs/architecture.md).

A new IPC capability touches three files in the same change: the handler in
`index.ts`, the method in `preload/index.ts`, and the type in `env.d.ts`.

## Rules the code keeps

These are not style preferences. Breaking one will get a change sent back.

1. **The file is the source of truth.** Anything the app shows must be
   derivable from the files. The index and `.sessions/` are helpers that
   can be deleted.
2. **The window never touches the file system.** Every file operation goes
   through a typed handler in the main process, which checks the path stays
   inside the context.
3. **Keep the sandbox.** `sandbox: true`, `contextIsolation: true`,
   `nodeIntegration: false`. Do not relax them to make a feature easier.
4. **Page text equals file text.** The rendered draft keeps every character
   of the file in the page (markup is hidden, not removed). Selection and
   anchoring depend on this. `tests/markdown.test.ts` checks it.
5. **Agents do not decide what they may change.** Any path that writes an
   agent's change goes through `judge` in `sessions.ts`, or the MCP write
   path that calls it.
6. **No silent network.** Nothing connects anywhere unless the reader starts
   it.

Three more follow from the security model. They are in
[SECURITY.md](SECURITY.md) and [docs/architecture.md](docs/architecture.md):
a context runs no program unless the reader marked it as trusted, the
window never names a path outside the context for main to read, and what
only the reader may decide (trust, instruction files, publishing) is asked
in a dialog of the system.

## Code style

- Match the file you are in: comment density, naming, and idiom.
- Comments explain *why*, not *what*. Keep them short.
- Prefer the standard library and the platform before a new dependency.
- Where a shortcut has a known ceiling, mark it with a `ponytail:` comment
  that names the ceiling and the upgrade path, for example:
  `// ponytail: one JSON file, searched end to end. Good for some thousands of files.`
  The `ponytail:` comments are collected by hand. Keep them accurate.
- Tests are plain `node:test` with `node:assert/strict`. A new branch of
  logic gets one test that fails if the logic breaks.

## Commits and pull requests

- One logical change per commit. Write the subject in the imperative,
  under about 70 characters, and say *why* in the body.
- Do not commit generated output (`out/`, `dist/`, `node_modules/`), the
  compiled helper (`apps/desktop/assist/mate-assist`), or anything from a
  real context.
- A pull request should say what changed, why, and how you checked it. For
  anything visible in the window, say how you looked at it, and attach a
  screenshot if you can.
- The pull request template has a checklist. Tick what you ran, and say
  what you did not run.

## Testing the window

The unit tests cover the logic: the marker format, typing in a draft, the
shelf and the dropbox, the guard, the index, the agent adapters, an agent
that stays, the instruction files, the script runner, and the MCP
endpoint. They do not drive the window.
`pnpm test:e2e` does: it starts the built app on a copy of the example
context and goes through the main paths, with no agent. When you change
anything the reader sees, run it, add a step to it if your path is not
there, and still run `pnpm dev`, open `contexts/_example`, and try the
path you changed. Say so in the PR.

Agents are tested against stand-ins in the unit tests. If you change how
an agent is started or how its output is read, try the real tool once and
say which version you used.

## Licensing

By contributing you agree that your contribution is released under the
[MIT License](LICENSE) that covers the project.
