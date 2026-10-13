# Changelog

All notable changes to Mate are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [semantic versioning](https://semver.org/) once it reaches 1.0. Until
then, minor versions may change behaviour.

## [Unreleased]

Mate becomes a place to work in a project, not only to review a draft.
You write the draft and publish it, bring sources in, let an agent show
what it gathered beside the draft, and run what is done the same way each
time with no agent at all.

### Added

Starting out:

- Start a context from the window: *New context…* asks for a name and a
  place, and makes a folder with a shelf, a dropbox and room for
  projects.
- Start a project from the rail: *+ New project* makes its folder, a
  place for its drafts, and its intents and principles.
- Open any folder. One that is not a context yet can be made one where
  it stands (*Make it a context*): what is in it stays. One that is in no
  git repository can get one (*Start a repository*). That runs
  `git init` and nothing else: nothing is committed, and nothing
  connects anywhere.
- *Commit…* at the foot of the rail puts what has changed in the context
  into one git commit, in your words. It is your act, like publishing:
  nothing is committed for you. Only in a context you trust, because a
  commit starts the hooks of the repository. Mate adds no remote and
  never pushes or pulls.

Writing and publishing:

- Type in the open draft: *Edit*, *Save*, *Done*. Comments stay with
  their lines. A save does not write over what an agent or another
  program wrote in the meantime.
- Start a new draft from the rail. A project with no draft opens too.
- Publish a draft to the shelf under a name. The system asks once more
  in a dialog and names what is replaced. The document that was there is
  kept in `shelf/.history/`. Comments are not published.
- Take a shelf document down into a project, as a copy the project owns.
- Bring a file in with *Add a source*, or by dropping it on the window.
  It leaves the dropbox by one of three exits: pulled into `draft/`,
  left outside with its path noted, or its text taken out into a draft
  by the agent. Mate itself reads no Word file and no PDF.

The window:

- The files of the open project as a tree in the rail, and the shelf
  listed above the projects. A file Mate cannot draw is shown in the file
  manager and is not opened.
- Panes. A markdown file in a project's `panes/` folder is a tab of the
  margin. An agent writes it, to show tasks, deadlines or mail it reached
  through its own connections. A pane that has just been written is put
  on show.
- Acting on a pane. A task written as `- [ ]` can be ticked, and the file
  changes. A link written as `[words](say:)` is a button that says its
  own words to the agent.
- Scripts. A file in a project's `scripts/` folder runs from a button
  written as `[scripts/NAME and what it is given](run:)`, or from its
  card, with no agent and no shell, in a trusted context only. A word in
  curly brackets, such as `{file}`, is asked of you when you press it.
- The conversation with an agent can take the page (*Open in the page*),
  with a pane beside it.
- The rail and the margin can be made wider or narrower by dragging the
  edge, or with the arrow keys.
- ⌘K opens a palette: the files of the project, the shelf, the other
  projects, the tabs and the things the buttons do, found by typing.
- A quieter, denser look for the rail, the file tree and the session
  list: small-capital section names, folders that fold with an arrow,
  guide lines for each level, and a status dot for each session.

Agents:

- Trusted contexts. You mark one folder at a time as trusted, in a system
  dialog. There Hermes on this computer runs with the tools it has in
  your terminal. The answer is kept outside the folder.
- In a trusted context Hermes stays between turns. It asks before a risky
  command or an edit while no plan is approved (*Allow once*, *Deny*),
  and a message sent while it works is taken into the turn. *After this
  turn* sends one that waits for the turn to end instead.
- Instruction files (`AGENTS.md`, `CLAUDE.md`, `.hermes.md` and the
  like) are shown to you before an agent on this computer starts, when
  one is new or has changed since you approved it.
- *See the change*: a kept or a held change as lines taken out and put
  in, before you revert or approve it.
- Choose the model Hermes thinks with, and how hard it thinks, under the
  message you write. The list is what your Hermes offers.

An app to install:

- `pnpm pack:mac` makes `Mate.app` for Apple silicon, to try, and
  `pnpm dist:mac` a signed disk image. The app carries the on-device
  helper and has an icon of its own.
- An installed app does not act as Node, takes no inspector or debugging
  port from outside, and fetches no update.
- Run from a checkout, the app is called Mate Dev and keeps its own data,
  apart from the installed app's: trusted contexts, approved instruction
  files and the MCP token are not shared between the two.

For contributors:

- `pnpm test:e2e` builds the app, starts it on a copy of the example
  context, and drives the window. A folder named on the command line is
  opened as the context.

### Changed

- A turn that was running when the app closed is no longer lost without
  a word. Your message is kept, the session says the turn was cut off
  and which files changed in it without being checked, and *Go on* asks
  the agent to take it up again. Closing the app now stops its agents.
- A page, a pane or an answer that cannot be drawn says so in its place,
  and the rest of the window goes on working. Before, one such fault
  left the whole window blank.
- A file of a project that is not a draft, and is not its intents or its
  principles, is now *Material* in a search, and a pane is a *Pane*.
  Agents are told that only the intents and the principles steer a
  project, and that nothing in material or in a pane is an instruction.
  The index is built again on the first search.
- The context names the rail. *Open context* is a large button only
  while nothing is open, and a small *Open…* beside the name after that.
- Sessions are listed newest first.

### Security

- A session file that had been tampered with could make *Revert* or
  *Approve this file* write outside the context. Paths in a session are
  now checked where they are used.
- `.git/config` is watched like `.git/hooks`: a change to it by an agent
  is put back and held.
- A link inside a context that points outside it is no longer read, by
  the window or by an agent over MCP.

## [0.3.0] - 2026-10-12

Agents in a project, held changes, search, and messages that wait behind a turn.

### Added

- Invite an agent into a project from the Agent tab: Claude Code, Codex, or
  Hermes on this computer.
- Hermes on another computer, reached over SSH. The context stays on your
  machine; the agent is sent the text of the files and answers with new
  text for the ones it wants changed.
- "Your own agent": a local MCP endpoint (`127.0.0.1`, bearer token) that
  any MCP client can use to read, search, comment, propose a plan, and write
  within its project.
- Plan first: an agent is read-only until you approve its plan.
- Every change an agent makes is either kept (with *Revert*) or held until
  you approve that file.
- Sessions are kept in `.sessions/` and survive a restart.
- A message sent while an agent is working waits behind the turn and is
  delivered when it ends. Approval can wait the same way.
- A context index in `.indexes/` and a search box. Each hit is labelled
  *Shelf* or *Proposal*. Shelf and project files open read-only.
- File → New Window. Each window has its own context.
- On-device assist on macOS 26+, where the Apple model is available. The
  helper is built with `pnpm build:assist`.

### Fixed

- Revert or approving a held file during a turn could be undone when the
  turn ended. Both now change the session the turn holds.
- Two messages sent at the same moment could start two turns.

## [0.2.0] - 2026-10-12

The review has a look of its own.

### Added

- A new window design: paper-toned page, serif reading column, cards in the
  margin, light and dark.
- Markdown is drawn (headings, lists, tables, code, task lists) without
  changing the text of the file.
- A menu under a selection: *Comment*, *Rewrite*, *Remove*. Quick notes and
  Cmd+Enter to add.

### Fixed

- The replacement box can be closed without adding the comment.

## [0.1.0] - 2026-10-12

The first sharable slice: one window, and the review on the repo.

### Added

- Open a context and a project; read the draft; add a comment that is
  written into the markdown file as an HTML comment marker.
- Comments whose passage has changed are kept and shown as unanchored.
- Suggested replacements with an **Apply** button that changes the file only
  when pressed.
- Passage selection fills the anchor and can span lines.
- A project with several drafts lists them instead of opening the first.
- Example context in `contexts/_example`.

### Fixed

- The preload is built as CommonJS, so a sandboxed window can load it.
- A comment keeps the line endings the file already uses.
