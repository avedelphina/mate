# Changelog

All notable changes to Mate are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [semantic versioning](https://semver.org/) once it reaches 1.0. Until
then, minor versions may change behaviour.

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
