# Mate

A desk for a body of work. The files are the application.

Mate is a desktop window onto a folder of markdown. You open a *context*,
open a *project* inside it, read the *draft*, and leave review comments
that are written into the draft file itself. An agent can be invited into
a project to read the context, propose a plan, and make changes that you
approve. Nothing is copied into a database, and nothing needs a server.

> **Status: early.** Version 0.3.0. Built and driven by hand on macOS. No
> installer yet: you run it from a checkout. See [Known limits](#known-limits).

## Why it is built this way

- **The folder is the product.** Documents are plain markdown in folders.
  Deleting Mate loses no work. Anyone who does not run Mate can read the
  comments, because they are HTML comments in the text.
- **Git is the sync.** Mate keeps no second copy of a document and has no
  accounts. Commit, push, and pull as you already do.
- **A reference is not a proposal.** The `shelf/` folder is what is true
  now. A draft in a project is a proposal until someone publishes it.
- **An agent proposes; you decide.** An agent plans before it writes, and
  any change it makes outside its project is put back and held until you
  approve that one file.

The full rules are in [docs/model.md](docs/model.md). The design is in
[docs/architecture.md](docs/architecture.md).

## What it does today

- **Review on the repo.** Select a passage in a draft and choose
  *Comment*, *Rewrite*, or *Remove*. A rewrite is a suggested replacement
  with an **Apply** button. Threads sit in the margin with replies. A
  comment whose passage has changed is kept and shown as unanchored.
- **Markdown, drawn.** Headings, lists, tables, code, and task lists are
  drawn. The markup stays in the text and is hidden, so the page is the
  file, character for character.
- **Several drafts.** A project with more than one draft lists them.
- **Search.** A search box indexes the whole context. Each hit says whether
  it is on the shelf (what is true now) or in a proposal. The index lives
  in `.indexes/` and can be deleted at any time.
- **Read-only files.** Shelf files and project instructions open to be
  read, not commented on.
- **Two windows.** *File → New Window* opens a second context or document.
- **Invite an agent.** The *Agent* tab of the margin talks to:
  - Claude Code, Codex, or Hermes on this computer;
  - Hermes on another computer, over SSH (the folder stays on your machine);
  - an agent you run yourself, through a local MCP endpoint.

  See [Agents](#agents) below.
- **On-device assist (macOS 26+).** Where Apple's on-device model is
  available, the rewrite and comment forms can draft text. You still press
  *Add*. Elsewhere the button is shown but off.

## Quick start

Requirements: **Node.js 22 or newer**, **pnpm 10 or newer**. The desktop
app runs on macOS, Linux, and Windows through Electron, but only macOS has
been used so far.

```sh
git clone https://github.com/avedelphina/mate.git
cd mate
pnpm install
pnpm dev
```

Then choose **Open context** and pick a folder. To try it without touching
your own files, pick `contexts/_example` in this repository.

Other commands:

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the app with hot reload. |
| `pnpm test` | Runs the unit tests (Node's test runner). |
| `pnpm typecheck` | Type-checks the main, preload, and renderer code. |
| `pnpm build` | Builds the app into `apps/desktop/out/`. There is no installer yet. |
| `pnpm build:assist` | macOS only. Builds the on-device helper (needs Xcode command line tools and the macOS 26 SDK). |

The `pnpm-workspace.yaml` file allows build scripts for `electron` and
`esbuild`. If `node_modules/electron/dist` is missing after an install, see
[docs/mvp.md](docs/mvp.md) for the repair steps.

## Your context

A context is a folder. Mate expects this shape:

```
my-context/
  shelf/                 what is true now; changed only by publishing
  dropbox/               intake for material not yet placed
  projects/
    my-project/
      draft/             the documents under review (*.md)
      intents.md         which way to lean; never "done"
      principles.md      rules of engagement; not traded away
      dropbox/           intake for this project
```

Nothing here is required beyond `projects/<name>/draft/`. Mate creates two
helper folders on its own, each with a `.gitignore` that ignores its
contents:

- `.indexes/`: the search index. Safe to delete.
- `.sessions/`: agent conversations, the copies kept for *Revert*, and
  changes held for your approval. Deleting it forgets those sessions.

Comments are stored as HTML comments under the passage they discuss:

```markdown
The sentence being discussed.
<!-- @comment{"id":"1","anchor":"The sentence being discussed.","text":"Say why.","author":"you"} -->
```

## Agents

Mate never lets an agent decide for itself what it may change. Before each
turn it records the context; after the turn it compares. A change inside
the open project, once you have approved the plan, is kept, and you can
**Revert** it. Any other change is put back and **held** until you approve
that file.

| Agent | How Mate runs it | Requirement |
|---|---|---|
| Claude Code | `claude -p` in the project folder, with file tools only | `claude` on your `PATH` and signed in |
| Codex | `codex exec` in the project folder | `codex` on your `PATH` and `codex login` done |
| Hermes | `hermes chat` in the project folder, with the `file` toolset only. In a context you trust, with all its tools | `hermes` on your `PATH` |
| Hermes on another host | `ssh <host> hermes chat -Q …` with the `todo` toolset only | a host in `~/.ssh/config` with key login and Hermes installed there |
| Your own agent | an MCP endpoint at `http://127.0.0.1:41757/mcp` | any MCP client; see below |

Agents are asked to plan first. Until you approve a plan, every turn is
read-only. A message sent while an agent is working waits behind the turn
and is delivered when it ends; it does not interrupt it.

### Connecting your own agent

Choose **Your own agent** in the Agent tab. Mate shows the address and a
token. The token is kept in Mate's user data folder (on macOS,
`~/Library/Application Support/Mate/mcp-token`) and is reused between runs.

```sh
claude mcp add --transport http mate http://127.0.0.1:41757/mcp \
  --header "Authorization: Bearer <token>"
```

The endpoint listens on `127.0.0.1` only, refuses any request that carries
an `Origin` header (a browser sends one, an agent does not), and needs the
token. Set `MATE_MCP_PORT` to use another port.

Tools: `mate_project`, `mate_read`, `mate_search`, `mate_comments`,
`mate_comment`, `mate_reply`, `mate_plan`, `mate_status`, `mate_write`.

## Security and privacy

- Mate sends nothing to any server of its own, and has no telemetry. The
  only network connections are the ones you start: an agent you invite, an
  SSH session you choose, and the local MCP endpoint.
- Agents are given file tools and no shell or web access. Claude Code is
  started without the settings and hooks of the context folder or of your
  account, so a context from someone else cannot run code through them.
- The exception is a context you mark as trusted. There Hermes runs as it
  does in your terminal, with commands and your connections. Mate asks
  for each folder in a system dialog and keeps the answer outside the
  folder. It still checks what changes inside the context, and it does
  not see what the agent does outside it.
- The renderer is sandboxed (`sandbox`, `contextIsolation`, no
  `nodeIntegration`). It reaches the file system only through the typed
  handlers in `apps/desktop/src/main/`.

Read [SECURITY.md](SECURITY.md) for how to report a problem.

## Known limits

- **No packaged app.** Run from a checkout with `pnpm dev`.
- **Tested on macOS only.** Linux and Windows build, and the review works
  without the on-device assist, but they have not been exercised by hand.
- **Codex needs its own sign-in** (`codex login`). Until then Mate shows the
  error from Codex.
- **The guard works after a turn, not during it.** An agent that writes
  outside its project does so before Mate can put the file back. The
  change is reverted and held, but it exists on disk for the length of
  that turn.
- **One agent works in a context at a time.**
- **A running turn is lost if the app quits.** Its session survives, and
  messages that were waiting go with your next message.
- **Over SSH an edit replaces the whole file.** There is no diff view yet.
- **Search reads each file whole,** up to 2 MB, and is sized for thousands
  of files, not hundreds of thousands.
- **Ambiguous passages.** A passage that occurs twice on the same line
  cannot be commented on by itself. Select a little more around it.
- **The on-device assist** needs macOS 26 with Apple Intelligence turned on
  and the model downloaded.

## Documentation

- [docs/model.md](docs/model.md): the rules: context, project, session, shelf, drafts.
- [docs/architecture.md](docs/architecture.md): how the desktop app is built and where a change goes.
- [docs/roadmap.md](docs/roadmap.md): the order Mate grows in, and what is built.
- [docs/mvp.md](docs/mvp.md): the first slice, the checks it passed, and what was verified by hand.
- [docs/brief-review.md](docs/brief-review.md): the working brief for the review slice (kept as history).
- [apps/desktop/README.md](apps/desktop/README.md): the desktop app's layout and environment variables.
- [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md), [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Copyright (c) 2026 Tomas Kracmar and Mate contributors.
