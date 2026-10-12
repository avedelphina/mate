# Mate desktop

The Electron app. It is the only application in this repository; the rules
it follows are in [../../docs/model.md](../../docs/model.md).

## Running it

From the repository root:

```sh
pnpm install
pnpm dev
```

Or from this folder: `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm build`,
`pnpm build:assist`.

`pnpm dev` runs `electron-vite dev`, which starts a Vite server for the
window and launches Electron. If the window opens blank, check that
`out/preload/index.cjs` exists after a build: the window loads the preload
from there.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MATE_MCP_PORT` | `41757` | Port of the local MCP endpoint. If it is taken, Mate picks a free one and shows the address. |
| `MATE_ASSIST` | `assist/mate-assist` | Path to the on-device helper. Set it to point at another build. |
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
  preload/
    index.ts        window.mate: the only bridge from the window to main
  renderer/src/
    App.tsx         the window: rail, page, margin
    Rendered.tsx    draws the markdown and the highlights
    Agent.tsx       the Agent tab of the margin
    Tree.tsx        the files of the open project, in the rail
    markdown.ts     the markdown tree; every character appears once, in order
    env.d.ts        the types of window.mate, shared by both sides
  shared/
    comments.ts     the comment marker: parse, insert, reply, apply, anchor
assist/
  main.swift        the on-device helper: one question in, one answer out
tests/              node:test unit tests, run with --experimental-strip-types
```

## Testing

`pnpm test` runs every file in `tests/`. The tests use real files in a
temporary folder, and stand-ins for the agent commands (small scripts that
print what the real tool prints). They do not start Electron.

## Building

`pnpm build` writes `out/main`, `out/preload`, and `out/renderer`. There is
no packaging step yet, so the built app cannot be distributed.
