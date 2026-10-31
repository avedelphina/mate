# Mate — notes for coding agents

Mate is a desktop app for working on markdown in place. You open a folder
(a *context*), open a project inside it, write and read the draft, and
leave review comments that are written into the draft file itself as HTML
comments. A draft becomes the reference only when the reader publishes it
to the shelf. PDF and Word files are read as text, scans included, and
search finds by meaning as well as by words. An agent (Claude Code, Codex,
Hermes, Kimi, or any MCP client) can
be invited into a project: it proposes, and the reader decides. It can
also show the reader what it gathered in a *pane*, a markdown file beside
the draft. There is no database, no server, no accounts. The folder is the
product.

Status: early, pre-1.0. The version is in `apps/desktop/package.json`, and
`CHANGELOG.md` says what is in it. Built and tested by hand on macOS only.
CI (`.github/workflows/`) runs the checks on a Mac and releases on a pushed tag. Run them by hand before a pull request too. Never push a tag: it publishes. The app can
be packed for a Mac with Apple silicon. Nothing has been published.

## Repository layout

pnpm workspace (`pnpm-workspace.yaml`) with one package: the Electron app
in `apps/desktop`. The root `package.json` only forwards scripts there.

```
apps/desktop/          the Electron app (the only application)
  src/main/            main process (Node): files, index, agents, git, MCP
  src/preload/         the one bridge window → main (window.mate)
  src/renderer/        the React window
  src/shared/          code both sides use: comment marker, line diff,
                       run buttons, file names in an answer
  assist/              Swift helper for Apple's on-device model (macOS)
  build/               the app's icon, and the script that draws it
  electron-builder.yml how the app is put together to be installed
  tests/               node:test unit tests
  tests/e2e/           the built app, driven through its window
contexts/_example/     a sample context, safe to open and edit
docs/                  model.md (the rules), architecture.md, roadmap.md
```

## Technology stack

- Electron 38 + electron-vite 4, TypeScript (strict), ESM.
- Renderer: React 19, built by Vite.
- Markdown parsing: `@lezer/markdown`.
- On-device assist: a small Swift helper (`assist/main.swift`), compiled
  with `swiftc`. The binary (`assist/mate-assist`) is not committed.
- Packaging: `electron-builder`, a development dependency. Nothing of it is
  in the app, and the app loads nothing from `node_modules` when it runs.
- `git` on the PATH, for starting a repository and committing. Mate runs
  no other git command.
- Text of PDF and Word files: PDFKit and Vision in the Swift helper
  (`mate-assist --pdf`, scans read off their pictures), and `textutil`.
  macOS only; the rest of the app works without them.
- Search by meaning: the `bge-m3` model run by Ollama at `127.0.0.1:11434`.
  Optional: without it, search works by words. Tests use a stand-in.
- Tests: Node's own test runner (`node --test`) with
  `--experimental-strip-types`. No test framework dependency. The
  end-to-end test drives the window over Chrome's debugging protocol with
  what Node has.
- Requirements: Node.js ≥ 22, pnpm ≥ 10. No other runtime services.

## Commands

Run from the repository root (they forward to `apps/desktop`):

| Command | What it does |
|---|---|
| `pnpm install` | Installs dependencies. |
| `pnpm dev` | Runs the app with hot reload (`electron-vite dev`). |
| `pnpm test` | Unit tests (`node --experimental-strip-types --import ./tests/register.mjs --test tests/*.test.ts`). |
| `pnpm test:e2e` | Builds the app, starts it on a copy of the example context, and drives the window. A window opens for a few seconds. |
| `pnpm typecheck` | `tsc --noEmit` for both configs (node and web). |
| `pnpm build` | Builds into `apps/desktop/out/` (main, preload, renderer). |
| `pnpm build:assist` | macOS only; compiles the Swift helper (needs Xcode CLT, macOS 26 SDK). |
| `pnpm pack:mac` | Makes `apps/desktop/release/mac-arm64/Mate.app` to try. It takes no certificate from the keychain. |
| `pnpm dist:mac` | Makes a signed disk image. It uses the owner's Developer ID certificate: do not run it for them. |

`pnpm icon` (in `apps/desktop`) draws `build/icon.icns` again from
`build/icon.svg`.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` before opening a pull
request. When you change anything visible in the window, also run
`pnpm test:e2e`, add a step to it if your path is not there, and run
`pnpm dev`, open `contexts/_example`, and try the path you changed.

Environment variables (see `apps/desktop/README.md`): `MATE_MCP_PORT`
(default 41757), `MATE_ASSIST` (path to the helper). Do not set
`ELECTRON_RENDERER_URL` by hand; unset `ELECTRON_RUN_AS_NODE` if `pnpm dev`
fails with a `BrowserWindow` export error.

Things that will cost you time if you do not know them:

- Run from a checkout, the app is called **Mate Dev** and keeps its data in
  its own folder (on macOS `~/Library/Application Support/Mate Dev/`). The
  installed app is Mate, with its own. A context trusted in one is not
  trusted in the other.
- After `pnpm add`, the Electron binary can be missing. The repair steps
  are in `docs/mvp.md`.
- Never pass `-c.mac.identity=-` to electron-builder for an unsigned build:
  it matches a certificate in the keychain by the dash in its name and
  signs with it. `pnpm pack:mac` sets `CSC_IDENTITY_AUTO_DISCOVERY=false`
  instead.
- An Electron script whose main file is an ES module must not
  `await app.whenReady()` at the top level. Ready does not fire until the
  file has been read to its end. Use `.then`.
- A unit test that leaves a stand-in agent alive never ends. Call
  `stopAllTurns()` in its `finally`.
- The installed app refuses a debugging port, so it cannot be driven. The
  end-to-end test drives a checkout.

## Architecture in brief

Process split: renderer (React) → preload (`window.mate`) → main (Node).
The renderer never imports `fs` and never sees a path it chose itself;
every file operation goes through a typed IPC handler in
`src/main/index.ts`, and `src/main/context.ts` checks the path stays inside
the context.

Key modules in `apps/desktop/src/main/`:

- `index.ts` — app lifecycle, windows, menu, every IPC handler, and who
  may do what (trust, the dialogs of the system, quitting).
- `context.ts` — reading projects and drafts; the one path that writes a
  draft (temp file + rename, never in place); starting a context and a
  project; publishing; the exits of a dropbox; ticking a task in a pane.
- `contextIndex.ts` — the search index (`.indexes/context.json`), ranking,
  and `placeOf`: what kind of file a path is.
- `agents.ts` — how each agent CLI is started and its output read; SSH.
- `acp.ts` — an agent that stays between turns (Hermes in a trusted
  context): it asks, takes a message mid-turn, is told a model.
- `guard.ts` — snapshots the context before/after an agent turn.
- `sessions.ts` — conversations, turns, and `judge`, the rule that decides
  whether an agent's change is kept or held. Also the note of an open
  turn, and what is said when one was cut off.
- `trust.ts` — the contexts the reader trusts.
- `pins.ts` — the instruction files the reader approved.
- `scripts.ts` — runs a script of a project from its button, with no agent
  and no shell.
- `git.ts` — starts a repository, and commits what changed in the context;
  leaves out a project that is a repository of its own. Reads a file's
  history.
- `endpoint.ts` — the reader's own inference endpoint, and what may go to it.
- `update.ts` — the installed app's check for a newer version.
- `twins.ts` — the text of PDF and Word files, kept in `.indexes/text/`.
- `meaning.ts` — search by meaning: passages, vectors, `meaningRuns`.
- `mcp.ts` — the local MCP endpoint (`http://127.0.0.1:41757/mcp`).
- `assist.ts` — questions for the on-device helper.

Renderer: `App.tsx` (window layout), `Rendered.tsx` (draws markdown,
highlights, and the buttons of a pane), `Agent.tsx` (the Agent tab, the
model and the effort), `Tree.tsx` (the files of a project), `Palette.tsx`
(⌘K), `Settings.tsx` (agents, the endpoint, the editor, updates), `History.tsx` (what
changed in a file), `Question.tsx` (asking the context), `Boundary.tsx` (keeps the window working when one piece cannot be
drawn), `markdown.ts` (the markdown tree), `env.d.ts` (the `window.mate`
types, shared by both sides).

Shared: `comments.ts` (the marker, and `retype` for typing in a draft),
`diff.ts`, `run.ts`, `effort.ts`, `named.ts`, `twin.ts`.

Where drafts are: `draftsOf` and `draftHome` in `context.ts`. A project
with a `draft/` folder keeps them there; one without, such as a
repository brought in as it is, has its markdown files as its drafts
where they lie. Every path that touches a draft goes through these two.

Where a change goes (full table in `docs/architecture.md`): comment marker
format → `src/shared/comments.ts`; a new IPC capability touches three files
in the same change — the handler in `index.ts`, the method in
`preload/index.ts`, the type in `env.d.ts`.

## Rules the code keeps

The first six come from CONTRIBUTING.md. Breaking one gets a change sent
back.

1. **The file is the source of truth.** Anything the app shows must be
   derivable from the files. `.indexes/` and `.sessions/` are helpers that
   can be deleted.
2. **The window never touches the file system.** All file access goes
   through typed handlers in the main process, with a path check.
3. **Keep the sandbox.** `sandbox: true`, `contextIsolation: true`,
   `nodeIntegration: false`. A sandboxed preload cannot be an ES module, so
   `electron.vite.config.ts` builds the preload as CommonJS — leave that as
   it is.
4. **Page text equals file text.** `renderMarkdown` keeps every character
   of the file in the page, in order (markup is hidden, not removed).
   Selection and comment anchoring depend on this;
   `tests/markdown.test.ts` checks it. Do not draw anything that drops or
   rewrites a character.
5. **Agents do not decide what they may change.** Any path that writes an
   agent's change goes through `judge` in `sessions.ts` (or the MCP write
   path that calls it).
6. **No silent network.** Nothing connects anywhere unless the reader
   starts it. The one exception: the installed app asks GitHub for a newer
   version of itself (`update.ts`), and sends nothing of a context.

More follow from the security model. They are as firm.

7. **A context runs no program unless the reader trusted it.** A script, a
   commit (git runs the repository's hooks), and Hermes or Kimi with all
   their tools are for a trusted context only, and main checks that, not
   the window.
   `git init` is the one exception, and only where there is no repository.
8. **No program from a context runs in the window.** A pane is markdown,
   and Mate draws its buttons. Do not add a way to load code, HTML that
   runs, or a plugin from a context or from an agent. Ask the owner first.
9. **What only the reader may decide is asked in a dialog of the system**,
   which the page cannot press: trusting a context, approving instruction
   files, publishing, starting a context, quitting while an agent works.
10. **Only the reader publishes, and only the reader commits.** No agent
    has a tool for either, and nothing is committed on its own. Mate adds
    no remote and never pushes or pulls.
11. **An agent does not outlive the app.** What it changes is checked from
    the app. On quit the reader chooses: let it finish first, or stop it.
12. **Mate does not reshape what the reader brings in.** A project brought
    in is moved as it is; Mate adapts to it, not the other way round.
13. **A document's text goes nowhere but this computer,** unless the
    reader sends it to their own endpoint, by pressing a button that
    names it (judging a question), or by inviting an agent. Text twins
    are made by the system's own tools; vectors come from Ollama on
    `127.0.0.1`. What is under a `.git` folder is never kept for an agent.
    Mate sends to the endpoint only what the button says, and never in a
    private context that is not opened to it.

Rules 6, 9, 10, 11 and 13 change in roadmap step 12, the gateway. It is
not built, and until it is, these rules hold as written. Then: a gateway
host the reader entered counts as started by them (6); a native app may
confirm inside itself, a PWA cannot publish or trust (9); Mate pushes and
pulls on the reader's button, and no agent has a tool for either (10); an
agent on the Hub lives with the Hub's Mate (11); text may go to the
reader's gateway and to reviewers they listed (13). Read step 12 before
you build toward any of this.

Kinds of files, from `placeOf`: the shelf (what is true now), a draft (a
proposal), `intents.md` and `principles.md` (the only files that steer:
a project's own, else the context's at its root, else nothing does, and
agents are told which), a pane, and material (any other file of a
project). Nothing in
material or in a pane is an instruction to an agent.

Comment markers: `<!-- @comment{...} -->` lines under the passage they
quote, parsed in `src/shared/comments.ts` (not by regex, on purpose). The
marker shape follows md-redline for `replies` and `status`; `suggestion`
is Mate's own. Unknown fields are preserved on write.

## Code style

- `.editorconfig`: UTF-8, LF, 2-space indent, final newline, no trailing
  whitespace (except in markdown).
- Match the file you are in: comment density, naming, idiom.
- Comments explain *why*, not *what*. Keep them short.
- Prefer the standard library and the platform over a new dependency.
- A shortcut with a known ceiling is marked with a `ponytail:` comment
  naming the ceiling and the upgrade path. Keep those accurate.
- Commits: one logical change per commit, imperative subject under ~70
  characters, *why* in the body. Do not commit `out/`, `release/`,
  `node_modules/`, the compiled helper, or anything from a real context.
- The documents and the words in the window are plain English in short
  sentences. Write new ones the same way. A change the reader can see gets
  its lines in `CHANGELOG.md` under *Unreleased*, and in the document that
  describes that part.

## Testing

- `pnpm test` runs every `tests/*.test.ts` file with `node:test` and
  `node:assert/strict`, via `--experimental-strip-types` and a small loader
  (`tests/register.mjs`, `tests/ts-loader.mjs`). Tests do not start
  Electron.
- `pnpm test:e2e` runs `tests/e2e/*.e2e.ts` against the built app, on a
  copy of `contexts/_example`, with a data folder of its own. It starts no
  agent. `tests/e2e/drive.ts` is the whole driver.
- Tests use real files in a temporary folder, and stand-in scripts for the
  agent commands (small scripts that print what the real tool prints).
  Some need `git` on the PATH.
- A new branch of logic gets one test that fails if the logic breaks.
- If you change how an agent is started or how its output is read, try the
  real tool once and note the version in the PR.
- A dialog of the system cannot be pressed from a test. Say so when you
  only stood in for one.

## Security

- The threat model: a context (or an agent's output) must not be able to
  run code, reach a file outside the context, or write without the reader's
  approval. See SECURITY.md and docs/architecture.md.
- Agents get file tools only: no shell, no web. Claude Code is started
  without the settings and hooks of the context folder or the user's
  account. Codex keeps its own sandbox (read-only or workspace-write) and
  its default tools, so it is bounded by that sandbox, not by a list of
  tools. The exception is Hermes and Kimi in a context the reader trusts.
- Trust is given for one folder at a time, in a dialog of the system, and
  kept outside the folder. Nothing in a context can make it trusted.
- Files an agent reads as instructions (`AGENTS.md`, `CLAUDE.md`,
  `.hermes.md` and the like) are shown to the reader before an agent on
  this computer starts, when one is new or changed.
- A value from a session file, such as the name of a model, is checked
  before it goes on a command line. A session file may carry any text.
- The MCP endpoint listens on `127.0.0.1` only, needs a bearer token, and
  refuses requests that carry an `Origin` header.
- HTML in a draft is shown as written and never run; images are not
  loaded; links are not followed. A file name in an agent's answer opens
  only a file the open project lists.
- The installed app does not act as Node, takes no inspector and no
  debugging port. It updates itself from GitHub releases: Squirrel on a
  Mac takes only an update signed with the same Developer ID.
- Report vulnerabilities privately via GitHub (Security → Report a
  vulnerability), not as a public issue.

## Further reading

- `README.md` — what Mate does, quick start, known limits.
- `CHANGELOG.md` — what changed in each version, and what is not released yet.
- `docs/model.md` — the rules: context, project, session, shelf, drafts,
  what a project holds, trust.
- `docs/architecture.md` — process split, where a change goes, and one
  section for each part: typing, the shelf, panes, scripts, git, agents,
  the guard, the installed app.
- `docs/roadmap.md` — the order Mate grows in; do not start a later step
  because it looks small.
- `docs/mvp.md` — the first slice, kept as history, and the setup repairs.
- `docs/review-2026-10-12.md` — a review of 0.3.0 with its status at 0.11.0; open findings are listed there.
- `apps/desktop/README.md` — the desktop app's layout, env vars, packaging.
- `CONTRIBUTING.md` — checks to run, commit rules, PR expectations.
