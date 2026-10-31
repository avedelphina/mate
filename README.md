# Mate

A desk for a body of work. The files are the application.

Mate is a desktop window onto a folder of markdown. You open a *context*,
open a *project* inside it, write and read the *draft*, and leave review
comments that are written into the draft file itself. An agent can be
invited into a project to read the context, propose a plan, make changes
that you approve, and show you what it gathered in a pane beside the
draft. Nothing is copied into a database, and nothing needs a server.

> **Status: early.** Version 0.15.1. Built and driven on macOS and Linux.
> [Download it](https://github.com/avedelphina/mate/releases/latest) for a
> Mac with Apple silicon or an x86-64 Linux computer, or run it from a
> checkout. See [Known limits](#known-limits) and the [changelog](CHANGELOG.md).

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
  Any text file of a project, such as an XML config, a CSV or a log, is
  reviewed the same way; its comments are kept beside it in
  `NAME.comments.md`, and the file changes only when you apply a
  suggestion. In a comment, `[[a file]]` opens that file and a `#tag`
  finds every comment that has it.
- **Code.** A text file shows its line numbers, and the search, by words
  and by meaning, reads code and any other text file. *Open in editor*
  opens the document in your editor at the comment or the selection: set
  the command in Settings, such as `code -g`. In a context you trust,
  *History* shows what changed since the last commit and each commit that
  changed the file, with what it changed.
- **Markdown, drawn.** Headings, lists, tables, code, and task lists are
  drawn. The markup stays in the text and is hidden, so the page is the
  file, character for character.
- **Start a context and a project.** *New context…* makes a folder with
  a shelf, a dropbox and room for projects, where you say. *+ New
  project* in the rail makes a project in it, with its intents and its
  principles. A folder you already have can be opened and made a context
  where it stands, and Mate offers to start a git repository for a
  context that is in none. Click the context's name to rename it;
  *Rename project…* sits under the open project.
- **Bring in a project.** *Bring in a project…* moves a folder you have,
  such as a git repository, into the context as a project, as it is.
  Mate writes nothing into it: its markdown files are its drafts where
  they lie, and a repository keeps its history and remote. The context's
  commits leave it out.
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
  button asks the agent to take its text out into a draft, with its
  headings and its form. A folder is copied into the project whole, with
  its folders, so search reads what is in it.
- **The files of a context.** The rail lists the shelf, then under
  *Context* the rest of the context that is not a project, such as its
  own dropbox.
- **The files of a project.** The rail shows them as a tree. A draft
  opens for review. So does any other markdown file of the project, such
  as material that came in: its comments are kept beside it, in
  `NAME.md.comments.md`, and the file itself is left as it was. Only a
  draft can be published. The dropbox, the panes, the scripts and the
  intents and principles open to be read, and a file Mate cannot draw is
  shown in the file manager. *+ New folder* makes a
  folder in the project: `notes`, or `draft/contracts`. A folder inside
  `draft/` keeps drafts, and they are reviewed and published as the others
  are. A folder of the drafts has a *+* that starts a draft in it. A file
  or a folder is moved by dragging its row onto another folder, or onto
  the project's name for the project's own place, or with *Move this file
  to…* in ⌘K. Its comments and its note go with it. A draft moved out of
  `draft/` is material, and one moved in is a draft; Mate says so. Nothing
  moves to the shelf: only publishing puts a document there. Nothing moves
  while an agent works in the context.
- **Search by meaning.** With Ollama on your computer and its `bge-m3`
  model (`ollama pull bge-m3`), the search also finds passages close to
  your question in meaning, in other words or another language: an English
  question finds the Czech or Slovak passage that answers it. It runs on
  your computer only. Without Ollama, search by words works as before.
  Press Enter in the search to ask the whole context: the passages
  closest to your question go on the page, whole, grouped by document,
  each opening at its place. Select a passage in a draft and choose
  *Near it* to see what your notes, the shelf and other drafts say close
  to it. No model writes the answer, so it works in a private context
  too. Where your own endpoint may read the context, it can be asked to
  pick which of the thirty closest passages answer the question: it only
  picks, and you still read the files' own text. Hermes in a context you
  trust searches the same way, through Mate, and answers from the passage
  it finds.
- **PDF and Word files, and tables, are read and found.** Mate takes the
  text out of every PDF, Word file, Excel workbook and CSV file in the
  context and keeps it as a helper in `.indexes/text/`. A scanned PDF is
  read off its pages. Each sheet of a workbook becomes a table. Search
  finds what they say, a policy on the shelf reads on the page, and agents
  are told where the text is. macOS uses its own tools; Linux uses optional
  external tools. Nothing leaves the computer.
- **Search.** A search box indexes the whole context. Each hit says what
  it is: *Shelf* (what is true now), *Proposal*, *Project file*,
  *Material*, or *Pane*. The index lives in `.indexes/` and can be
  deleted at any time.
- **Send to project.** When a context has more than one project, a
  selected passage has *Send to project…*. Pick the project, say what is
  wrong and what you propose, and the system asks once, naming the project.
  One file goes into that project's dropbox: your note, the passage as a
  quote, and where it came from. Nothing else in that project changes. It
  deals with it by the exits of a dropbox: pull it into the drafts, or
  leave it outside. The file you sent it from gets a line in its note.
  Only the passage goes, not the draft. Not while an agent works.
- **Final.** A draft says it is final in its front matter, as
  `status: final`. The bar and the tree show it. It means the finished
  document of its project, not the truth of the context: only the shelf is
  that. *Publish…* is for sending a document on to the shelf, which every
  project reads as what is true, and it is offered most plainly on a
  final draft. The name it suggests starts with the project's name, so two
  projects do not replace each other's documents by accident. An agent is
  told which drafts are final.
- **Notes.** The *Notes* tab of the margin holds a note about the file on
  the page: what it is for, what was decided, documentation, or a
  discussion. It is a markdown file beside it, `NAME.notes.md`, which you
  type in Mate, and it is searched like any file. Write `[[another file]]`
  in it and that file opens from the tab. An agent you invite is told the
  note is there and reads it with the file, and the files it names. Nothing
  in a note is an instruction to the agent.
- **Tags.** A markdown file names its tags in its front matter:
  `tags: contract, legal`, or `tags: [contract, legal]`, or a list under
  `tags:`. They are text in the file, so you type them in the draft and an
  agent can write them too. The bar of the open file shows them, the rail
  lists the tags in use under *Tags*, and a click searches for the tag.
  Searching `#contract` finds the files that name it, and the comments
  that use it. A tag is letters, numbers, dashes and underscores. Words
  with a space in them become one with dashes.
- **Notifications.** When Mate is behind another window, the system tells
  you that an agent has finished, has a plan to approve, is asking you
  something, or wants to change a file, and that a new version is ready.
  It names the agent and the project and nothing from a document. A press
  brings Mate forward. *Notifications* in Settings turns it off.
- **Read-only files.** Shelf files open to be read, not commented on. The
  intents and the principles of a project have a row each at the top of
  the project in the rail. A click opens the file on the page, and *Edit*
  in the bar lets you type it.
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
  - Claude Code, Codex, or Hermes on this computer, and Kimi in a context you trust;
  - Hermes on another computer, over SSH (the folder stays on your machine);
  - an agent you run yourself, through a local MCP endpoint.

  Agents on this computer are found on their own. Add a host for Hermes on
  another computer in *Settings*, under *Agents*; Mate adds none for you.

  A conversation that is not about a draft can take the page (*Open in
  the page*). See [Agents](#agents) below.
- **Private contexts.** *Keep this context private* in the *Agent* tab:
  no agent works in it, so nothing of it leaves your computer. Everything
  else still works. Letting agents in again asks in a system dialog. A
  private context can be opened to Hermes on your own inference endpoint:
  it runs in a network sandbox and its text goes only to that server.
- **Settings.** *Mate → Settings…* (Command/Ctrl+,), or the palette: your
  endpoint, the contexts you trust, the private ones, and what this
  computer has for search by meaning and the comment box. Settings are
  kept between starts in the app's data folder.
- **Windows.** *File → New Window* opens a second context or document.
  The rail and the margin are as wide as you drag them. **Command/Ctrl+K**
  opens a palette: type part of a file's name to open it, or the name of
  something to do.
- **On-device assist.** The rewrite and comment forms can draft text with
  Apple's on-device model on macOS 26+, or a local Ollama chat model on
  Linux. You still press *Add*. Where the model is unavailable, the button
  is off and says why.

## Quick start

On a Mac with Apple silicon, take the disk image from the
[latest release](https://github.com/avedelphina/mate/releases/latest),
open it, and drag Mate to Applications. It is signed and notarised.

On x86-64 Linux, take the AppImage, make it executable, and run it. On a
Debian-based system you can install the `.deb` instead. The AppImage needs
FUSE 2 on systems that do not already provide it. Linux packages are not
signed. Neither platform fetches an update: a new version is a new download.

Linux document tools are optional and installed separately, so Mate stays
small. Markdown review needs none of them:

| Capability | External tools on `PATH` |
|---|---|
| PDF text | `pdftotext` (Poppler) |
| Scanned PDF OCR | Poppler's `pdftotext` and `pdftoppm`, plus Tesseract with Czech and English data |
| DOC/DOCX, RTF, ODT and HTML | LibreOffice |
| Safari `.webarchive` | Python 3 |
| Hermes in a private context | Bubblewrap and Python 3 |
| Writing assist | Ollama with `qwen2.5:3b` (`ollama pull qwen2.5:3b`) |

Saving an endpoint key also needs the system keychain through Electron's
`safeStorage`; Mate never writes the key as plain text.

On Debian or Ubuntu, this installs the document and sandbox tools:

```sh
sudo apt install poppler-utils tesseract-ocr tesseract-ocr-ces \
  tesseract-ocr-eng libreoffice-writer python3 bubblewrap
```

Install only those you want. A missing tool disables only its kind of
extraction; it is used when you install it and search or reopen the context.

Hermes in a private context runs in a network namespace of its own, which
Ubuntu 24.04 and later do not let an ordinary user set up. There it stops
with `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. To
allow it for the whole system, which loosens a protection Ubuntu added:

```sh
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

Or give Bubblewrap an AppArmor profile that permits user namespaces, and
leave the setting as it is. Everything else in Mate works without either.

To run Mate from a checkout instead:

Requirements: **Node.js 22 or newer**, **pnpm 10 or newer**. The desktop
app runs on macOS, Linux, and Windows through Electron; macOS and Linux
are tested.

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
| `pnpm pack:linux` | Linux on x86-64. Makes `apps/desktop/release/linux-unpacked/mate` to try. |
| `pnpm dist:linux` | Makes an x86-64 AppImage and Debian package in `apps/desktop/release/`. |

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
| Kimi | `kimi acp`, in a context you trust only, with all its tools. It plans in its own plan mode, and asks before every step but a read | `kimi` on your `PATH` and signed in (`kimi login`) |
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
  instead. *Allow commands for this conversation* (or edits, or whatever
  kind of step it is) lets that kind through without asking again, and
  *Allow everything* lets every step through, except a question with
  answers to pick from. Both apply once the plan is approved, last until
  you close Mate or press *Ask again*, and are never written to a file.
  Mate still holds any change outside the project.
- A script of a project runs from its button.
- *Commit…* commits. A commit starts the hooks of the repository, and
  those are programs from the folder, like a script.

Kimi can be held to file tools by nothing Mate can pass it, so it works in
a trusted context only. It runs there with all its tools, asks before each
step but a read, and Mate says yes for it only to an edit, once you have
approved the plan. Until then it is in its plan mode, and the plan it makes
appears in the answer for you to approve. You can choose its model and how
hard it thinks. When it asks a question with answers to pick from, you see
the question and the answers, or you skip it. A message you send while it
works waits for the turn to end. Trust does not change Claude, Codex, or an agent on
another machine. It does not change who decides either: the plan comes first, a change
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
  SSH session you choose, and the local MCP endpoint. The one exception:
  the installed app asks GitHub for a newer version of itself when it
  starts and every six hours. It sends nothing of your contexts.
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
- Search by meaning sends the text of the context's documents to Ollama
  at `127.0.0.1`, on your computer, and nowhere else. It does so only if
  you have installed Ollama and pulled its `bge-m3` model.
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

- **Downloads are for Apple silicon macOS and x86-64 Linux.** On an Intel
  Mac, ARM Linux or Windows, run from a checkout with `pnpm dev`.
- **Windows is not exercised.** macOS and Linux are tested; the review
  works without the on-device assist where that is unavailable.
- **On Linux, LibreOffice reads every Word, RTF and ODT file** of an open
  context, trusted or not, so search can find its text. A document made
  to attack LibreOffice would run against it with your rights. Keep
  LibreOffice up to date, or do not install it if you open contexts from
  people you do not trust: those files then stay unread.
- **Codex needs its own sign-in** (`codex login`). Until then Mate shows the
  error from Codex.
- **The guard works after a turn, not during it.** An agent that writes
  outside its project does so before Mate can put the file back. The
  change is reverted and held, but it exists on disk for the length of
  that turn.
- **One agent works in a context at a time.** A script does not run
  while an agent is working there.
- **An agent does not outlive the app.** Quit while one works and Mate
  asks: *let it finish*, and Mate closes its windows and quits by itself
  when the work is done, or *stop it*. Left to finish, an agent that asks
  before it does something is told no. Stopped, the turn is cut off: the
  session says so when you open it again, names the files that changed
  in that turn and were not checked, and offers *Go on*. What the agent
  had answered so far is lost, and nothing is put back. If the app is
  killed or crashes, the agent may go on working for a while with nothing
  checking it: look at the files the session names.
- **Trust changes Hermes and Kimi only.** Claude and Codex keep their limits in
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
- **The intents and the principles of a context are not typed in Mate.** A
  new project gets both files with a line each. A project's own are typed
  in the margin. The ones at the root of a context, which a project
  without its own falls back on, are written in any editor.
- **Mate draws markdown and nothing else.** A PDF or a Word file is read
  as its plain text, without headings, tables or pictures. A scanned page
  is read off its picture, in Czech and English; Slovak reads well but
  for a letter or two. A workbook is read as its tables of values: a
  date is the number Excel keeps for it, and a chart is not read. Slides,
  `.xls` and Numbers files are named in the tree and opened by you, in
  their own program. On Linux, PDF, Office and OCR extraction needs the
  corresponding external tools listed in [Quick start](#quick-start).
- **Over SSH an edit replaces the whole file.**
- **Search by meaning needs Ollama and `bge-m3`,** about 1.2 GB. The first
  time, a large context takes a while to learn: about 75 ms a passage.
  Among invited agents only Hermes in a trusted context can use it.
- **Search reads each file whole,** up to 2 MB, and is sized for thousands
  of files, not hundreds of thousands.
- **Ambiguous passages.** A passage that occurs twice on the same line
  cannot be commented on by itself. Select a little more around it.
- **The on-device assist** needs macOS 26 with Apple Intelligence, or on
  Linux, Ollama and the configured chat model. The models and their answers
  differ between platforms. There is no assist on Windows.

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
