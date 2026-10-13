# Mate

A desk for a body of work. The files are the application.

Mate is a desktop window onto a folder of markdown. You open a *context*,
open a *project* inside it, write and read the *draft*, and leave review
comments that are written into the draft file itself. An agent can be
invited into a project to read the context, propose a plan, make changes
that you approve, and show you what it gathered in a pane beside the
draft. Nothing is copied into a database, and nothing needs a server.

> **Status: early.** Version 0.3.0. Built and driven by hand on macOS. No
> download yet: you run it from a checkout, or build the app yourself. See
> [Known limits](#known-limits).
> `main` is ahead of that release: see *Unreleased* in the
> [changelog](CHANGELOG.md).

## Why it is built this way

- **The folder is the product.** Documents are plain markdown in folders.
  Deleting Mate loses no work. Anyone who does not run Mate can read the
  comments, because they are HTML comments in the text.
- **Git is the sync.** Mate keeps no second copy of a document and has no
  accounts. Mate starts the repository if you ask and commits when you
  say so. Push and pull as you already do.
- **A reference is not a proposal.** The `shelf/` folder is what is true
  now. A draft in a project is a proposal until someone publishes it.
- **An agent proposes; you decide.** An agent plans before it writes, and
  any change it makes outside its project is put back and held until you
  approve that one file. Only you publish.
- **An agent shapes the window.** What Mate has no feature for, an agent
  writes into a pane: a markdown file that Mate draws beside the draft.
  No program from a context runs in the window.

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
- **Start a context and a project.** *New context…* makes a folder with
  a shelf, a dropbox and room for projects, where you say. *+ New
  project* in the rail makes a project in it, with its intents and its
  principles. A folder you already have can be opened and made a context
  where it stands, and Mate offers to start a git repository for a
  context that is in none.
- **Commit.** *Commit…* at the foot of the rail puts what has changed in
  the context into one git commit, in your words. Nothing is committed
  for you. Only in a [context you trust](#a-context-you-trust).
- **Write the draft.** *Edit* turns the page into the text of the file,
  to type in. Comments stay with their lines, and a save never writes
  over what an agent or another program wrote in the meantime. *New
  draft* in the rail starts one.
- **The shelf.** The rail lists what is on it. *Publish* puts a draft on
  the shelf under a name, after you confirm it in a system dialog. The
  document it replaces is kept in `shelf/.history/`. A shelf document can
  be taken down into a project, as a copy the project owns.
- **Sources.** *Add a source*, or drop a file on the window. A markdown
  file is pulled into the drafts. A file that stays where it is gets a
  note with its path, so a search finds it. For a Word file or a PDF, one
  button asks the agent to take its text out into a draft. Mate reads no
  such file itself.
- **The files of a project.** The rail shows them as a tree. A draft
  opens for review, any other markdown file opens to be read, and a file
  Mate cannot draw is shown in the file manager.
- **Search.** A search box indexes the whole context. Each hit says what
  it is: *Shelf* (what is true now), *Proposal*, *Project file*,
  *Material*, or *Pane*. The index lives in `.indexes/` and can be
  deleted at any time.
- **Read-only files.** Shelf files, the intents and the principles open
  to be read, not commented on.
- **Panes.** A markdown file in a project's `panes/` folder is a tab of
  the margin. An agent writes it, to show you tasks, deadlines or mail it
  reached through its own connections. You can tick a task in it, and a
  line written as `[words](say:)` is a button that says those words to
  the agent.
- **Scripts.** What is done the same way each time is a file in the
  project's `scripts/` folder. A button written as
  `[scripts/NAME and what it is given](run:)` runs it. No agent is asked,
  so it works with no network and costs nothing. Only in a
  [context you trust](#a-context-you-trust).
- **Invite an agent.** The *Agent* tab of the margin talks to:
  - Claude Code, Codex, or Hermes on this computer;
  - Hermes on another computer, over SSH (the folder stays on your machine);
  - an agent you run yourself, through a local MCP endpoint.

  A conversation that is not about a draft can take the page (*Open in
  the page*). See [Agents](#agents) below.
- **Windows.** *File → New Window* opens a second context or document.
  The rail and the margin are as wide as you drag them. **⌘K** opens a
  palette: type part of a file's name to open it, or the name of
  something to do.
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

Then choose **Open context** and pick a folder, or **New context…** to
start one. To try it without touching your own files, pick
`contexts/_example` in this repository.

Other commands:

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the app with hot reload. |
| `pnpm test` | Runs the unit tests (Node's test runner). |
| `pnpm test:e2e` | Builds the app, starts it on a copy of the example context, and drives the window. A window opens for a few seconds. |
| `pnpm typecheck` | Type-checks the main, preload, and renderer code. |
| `pnpm build` | Builds the app into `apps/desktop/out/`. |
| `pnpm build:assist` | macOS only. Builds the on-device helper (needs Xcode command line tools and the macOS 26 SDK). |
| `pnpm pack:mac` | macOS on Apple silicon. Makes `apps/desktop/release/mac-arm64/Mate.app` to try on this Mac. |
| `pnpm dist:mac` | Makes a signed disk image. It needs a Developer ID certificate: see [apps/desktop/README.md](apps/desktop/README.md). |

The `pnpm-workspace.yaml` file allows build scripts for `electron` and
`esbuild`. If `node_modules/electron/dist` is missing after an install, see
[docs/mvp.md](docs/mvp.md) for the repair steps.

## Your context

A context is a folder. Mate expects this shape:

```
my-context/
  shelf/                 what is true now; changed only by publishing
    .history/            what a publish replaced, by name and time
  dropbox/               intake for material not yet placed
  projects/
    my-project/
      draft/             the documents being written and reviewed (*.md)
      intents.md         which way to lean; never "done"
      principles.md      rules of engagement; not traded away
      dropbox/           intake for this project
      panes/             what an agent gathered to show you (*.md)
      scripts/           what is done the same way each time
```

Mate makes this shape for you: *New context…* the outer one, *+ New
project* a project. Or make the folders yourself. Nothing here is
required beyond `projects/<name>/`, and any folder can be opened as a
context. Any other file in a project is material: what came in for the
work, or was made in it. Only `intents.md` and `principles.md` steer a
project.

Mate creates two helper folders on its own, each with a `.gitignore` that
ignores its contents:

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
| Hermes | `hermes chat` in the project folder, with the `file` toolset only. In a context you trust, `hermes acp` with all its tools | `hermes` on your `PATH` |
| Hermes on another host | `ssh <host> hermes chat -Q …` with the `todo` toolset only | a host in `~/.ssh/config` with key login and Hermes installed there |
| Your own agent | an MCP endpoint at `http://127.0.0.1:41757/mcp` | any MCP client; see below |

A file an agent names in its answer, written as code, opens when you
press it.

Agents are asked to plan first. Until you approve a plan, every turn is
read-only. A message sent while an agent is working waits behind the turn
and is delivered when it ends; it does not interrupt it. Before you revert
a change or approve a held one, *See the change* shows it as lines taken
out and lines put in.

With Hermes on this computer you choose the model, and how hard it
thinks, under the message you write. The list is what your Hermes offers.

### A context you trust

By default an agent gets tools for files and nothing else. *Trust this
context…* in the Agent tab changes that for one folder. Mate asks in a
system dialog and keeps the answer outside the folder, so nothing in a
context can make it trusted. In a trusted context:

- Hermes on this computer runs with the tools it has in your terminal:
  its own tools, its skills, your connections, commands. That is how a
  pane gets your tasks or your mail.
- Hermes stays between turns. It asks you in the conversation before a
  risky command, or before an edit while no plan is approved (*Allow
  once* or *Deny*), and a message you send while it works is taken into
  the turn. *After this turn* sends it to wait for the turn to end
  instead.
- A script of a project runs from its button.
- *Commit…* commits. A commit starts the hooks of the repository, and
  those are programs from the folder, like a script.

Trust does not change Claude, Codex, or an agent on another machine. It
does not change who decides either: the plan comes first, a change
outside the project is held, and only you publish. Trust a folder whose
files you know, because a file in it can ask the agent for anything.

### Instruction files

Agents read some files of the folder they work in as their instructions:
`AGENTS.md`, `CLAUDE.md`, `.hermes.md`, `.cursorrules` and a few more.
Before an agent on this computer starts, Mate shows you any such file
that is new or has changed since you last approved it, with the lines
that differ. *Cancel* does not start the agent.

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
- The exception is a context you mark as trusted. There Hermes runs with
  the tools it has in your terminal, commands and your connections
  included, and asks you in the conversation before a risky command.
  Mate asks for each folder in a system dialog and keeps the answer
  outside the folder. It still checks what changes inside the context,
  and it does not see what the agent does outside it.
- A script in a project's `scripts/` folder runs when you press its
  button, with no agent, and only in a context you marked as trusted. It
  is a program with your rights.
- Files that an agent reads as its instructions, such as `AGENTS.md`, are
  shown to you before an agent starts, when they are new or have changed
  since you last approved them.
- A pane is markdown that Mate draws. Its buttons are drawn by Mate from
  the text, and a button that speaks to the agent says exactly the words
  it shows. No program from a context runs in the window.
- Publishing is confirmed in a system dialog that the page cannot press.
  No agent can publish.
- Git starts programs a repository names: its hooks, and what its config
  says. So Mate runs it in two cases only. *Start a repository* runs
  `git init` where there is no repository, in any context. *Commit…*
  runs in a context you marked as trusted, and nowhere else. Mate adds no
  remote, and never pushes or pulls.
- The list of models is asked of Hermes only when you open the choice,
  because Hermes may look its models up on the network.
- The renderer is sandboxed (`sandbox`, `contextIsolation`, no
  `nodeIntegration`). It reaches the file system only through the typed
  handlers in `apps/desktop/src/main/`.

Read [SECURITY.md](SECURITY.md) for how to report a problem.

## Known limits

- **No download yet.** Run from a checkout with `pnpm dev`, or make the
  app with `pnpm pack:mac`. That one is for Apple silicon, and nothing
  has been published.
- **Tested on macOS only.** Linux and Windows build, and the review works
  without the on-device assist, but they have not been exercised by hand.
- **Codex needs its own sign-in** (`codex login`). Until then Mate shows the
  error from Codex.
- **The guard works after a turn, not during it.** An agent that writes
  outside its project does so before Mate can put the file back. The
  change is reverted and held, but it exists on disk for the length of
  that turn.
- **One agent works in a context at a time.** A script does not run
  while an agent is working there.
- **A turn is cut off if the app quits.** The agent is stopped. When you
  open the session again it says so, names the files that changed in
  that turn and were not checked, and offers *Go on*. What the agent had
  answered so far is lost, and nothing is put back. If the app is killed
  or crashes, the agent may go on working for a while with nothing
  checking it: look at the files the session names.
- **Trust changes Hermes only.** Claude and Codex keep their limits in
  every context, and take their model from their own settings.
- **No thinking effort in a trusted context.** Hermes 0.21.5 cannot be
  told one while it stays between turns, so it uses its own setting.
- **A pane does not update itself.** Its tab says when it was written.
  Ask the agent to write it again.
- **A script cannot ask anything while it runs.** What it needs, it is
  given on its line or takes from a file. It is stopped after five
  minutes.
- **What a publish replaced is kept but not shown.** It is in
  `shelf/.history/`, to be read with any other tool.
- **No remote, no push, no pull from Mate.** Connecting a context to a
  repository elsewhere, and moving commits, are done with git: in a
  terminal, or by an agent in a context you trust.
- **A commit takes everything that changed in the context.** There is no
  choosing of files and no look at the difference before it. For that,
  use git.
- **The intents and the principles are not typed in Mate.** A new project
  gets both files with a line each. Write them in any editor.
- **Mate draws markdown and nothing else.** A Word file, a spreadsheet or
  a PDF is named in the tree and opened by you, in its own program.
- **Over SSH an edit replaces the whole file.**
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
