# Architecture

The desktop app renders the folders described in [model.md](model.md).
The folders remain the product. Deleting the app loses no work, because
the work is the markdown.

## Process split

```
renderer (React)                preload                     main (Node)
App.tsx                         window.mate                 index.ts
  openContext()      ---------> ipc 'context:open'   -----> folder dialog, list projects
  currentContext()   ---------> ipc 'context:current' ----> what this window already has open
  searchContext()    ---------> ipc 'context:search' -----> bring the index up to date, search it
  readFile()         ---------> ipc 'file:read'      -----> a file that is read, not reviewed
  startSession()     ---------> ipc 'session:start'  -----> a new conversation with one agent
  sendMessage()      ---------> ipc 'session:send'   -----> one turn of the agent, then the guard
  settleHeld()       ---------> ipc 'session:settle' -----> approve one held file, or drop it
  revertChange()     ---------> ipc 'session:revert' -----> put a file back as it was
  onSession()        <--------- ipc 'session:update' <----- the session as the agent goes on
  openProject()      ---------> ipc 'project:open'   -----> readProject()
  addComment()       ---------> ipc 'comment:add'    -----> insertComment()
  addReply()         ---------> ipc 'comment:reply'  -----> addReply()
  applySuggestion()  ---------> ipc 'comment:apply'  -----> applySuggestion()
  anchorComment()    ---------> ipc 'comment:anchor' -----> anchorComment()
  checkAssist()      ---------> ipc 'assist:check'   -----> is the helper here, can the model answer
  runAssist()        ---------> ipc 'assist:run'     -----> the helper, once per question
```

The renderer never imports `fs` and never sees a path it chose itself.
Every file operation goes through `context.ts`, which checks the path
stays inside the context before reading or writing.

`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
Do not relax these to make a feature easier. A sandboxed window cannot
load an ES module as its preload, so `electron.vite.config.ts` builds the
preload as CommonJS. Leave that as it is.

## Where a change goes

| Change | File |
|---|---|
| Comment marker format | `apps/desktop/src/shared/comments.ts` |
| Reading a project, writing the draft, path check | `apps/desktop/src/main/context.ts` |
| A new capability the window can call | `src/main/index.ts`, then `src/preload/index.ts`, then `src/renderer/src/env.d.ts` |
| Layout | `src/renderer/src/App.tsx` and `styles.css` |
| How markdown is drawn | `src/renderer/src/markdown.ts`, then `styles.css` |
| What the assist is asked | `src/main/assist.ts` |
| What is indexed, how a search ranks | `src/main/contextIndex.ts` |
| What a pane is, and how it is read | `readProject` in `src/main/context.ts`, then `App.tsx` |
| How an agent is started and its output read | `src/main/agents.ts` |
| What an agent may change | `src/main/guard.ts`, then `src/main/sessions.ts` |
| What an agent is told at the start | `RULES` in `src/main/sessions.ts` |
| What an agent of the reader's own can do | `src/main/mcp.ts` |
| How the on-device model is called | `assist/main.swift` |

Add the preload and the type in `env.d.ts` in the same change as the
handler. A handler the renderer cannot name does not exist.

## Comment markers

A comment is a line in the draft, directly under the last line of the
passage it quotes:

```
The sentence being discussed.
<!-- @comment{"id":"1","anchor":"The sentence being discussed.","text":"Why.","author":"you"} -->
```

`parseComments` scans for `<!-- @comment` and closes on the first `-->`
whose body parses as JSON with a string `anchor` and a string `text`.
A broken marker is left in the file and skipped. Do not replace this
with a regex: a regex cannot tell a broken marker's closer from the
real one and then swallows the next marker.

Three fields are optional. `replies` is the thread, and `status` is
`"resolved"` once the comment is done. Both have the names and shapes
md-redline uses. `suggestion` is the text proposed in place of the anchor,
and it is Mate's own: md-redline has no such field. Any other field a
marker carries is written back as it was found.

`insertComment` places a new marker after the markers already attached
to that line, never between the line and its first marker. Ids count up
from the highest id already in the file. A `-->` inside a note is written
as `--\u003e`, so the marker stays one HTML comment for every other reader.

## The text and the anchor

`readDocument` returns the text the window shows: the markers cut out and
the line endings as `\n`. An anchor is a passage of that text. It may run
over several lines, and it is the same string in a file with Windows line
endings.

The marker says which line the passage ends on, and nothing finer. So the
quote directly above the marker wins over the same words elsewhere in the
file, and `insertComment` refuses a passage that occurs twice on its own
line. A marker md-redline wrote sits just before its passage, and is read
that way.

A comment whose quote is nowhere in the text has `start: null`. It is
kept and shown as unanchored. Nothing re-anchors it but `anchorComment`,
which runs when the reader selects a passage and presses the button.

`applySuggestion` is the only function that changes the prose. It runs
when the reader presses Apply. It replaces the passage, sets `status` to
`"resolved"`, and keeps any other comment's marker that was inside the
passage.

## Drawing the markdown

The page draws the draft as markdown: headings, lists, tables, code. It
does this without changing the text. `renderMarkdown` in `markdown.ts`
turns the text into a tree in which every character is in exactly one
leaf, in order. Markup such as `**` or `](address)` is a hidden leaf. It
is in the page and not shown.

So the text of the page is the text of the file, character for character,
and what the reader selects is a passage of the file. `pickPassage` in
`App.tsx` depends on this, and `tests/markdown.test.ts` checks it. Do not
draw anything that drops or rewrites a character. If the two texts differ,
comments land in the wrong place.

The parser is `@lezer/markdown`, because it reports where every piece of
markup is. HTML in a draft is shown as written and never run. Images are
not loaded, and a link is not followed.

The quote in a thread card is the passage as it is in the file, markup
included.

Selecting a passage opens a small menu under it: Comment, Rewrite, Remove.
The form then opens in the same place. Both are drawn beside the page
element, never inside it. Anything put inside the page becomes part of
the text a selection is measured against.

## The assist

On a Mac with Apple's on-device model, the form under a selection has one
more button: Draft the rewrite, or Draft the note. Electron cannot call the
Foundation Models framework, so a small native helper does.

`assist/main.swift` is the whole helper. It takes one question on stdin,
gives one answer on stdout, and keeps no state. It knows nothing about
Mate. `src/main/assist.ts` decides what to ask, so the wording of a
question is in one place and has a test. `pnpm build:assist` compiles the
helper to `assist/mate-assist`, which is not committed.

The button is there only where the helper is. Where the helper is and the
model cannot answer, the button is off and says why. Linux and Windows
have no helper, and nothing else about the review changes there.

The model's text goes into the form. It reaches the file only when the
reader presses Add, as any comment does. Nothing leaves the computer.

## Writing a file

`editDraft` reads the draft, changes it, writes a temporary file in the
same directory, and renames it over the draft. Do not write the draft in
place. A crash mid-write would leave a half-saved document. Every change
starts from the file on disk, not from what the window last showed.

Every edit is a splice. Lines the edit does not touch keep their bytes,
and a new line takes the line ending the file already uses.

The window reads the draft again when it gets the focus back, because the
file may have been edited or pulled in the meantime. There is no file
watcher.

## The index and the search

A context has an index: `.indexes/context.json` inside the context folder.
It holds, for every markdown file in the context, where the file stands,
its title, its text as the page shows it, and the text of its comments.
`refreshIndex` brings it up to date before every search. It reads a file
again only when the file's size or time has changed.

The index is a helper. Deleting it loses nothing: the next search builds
it again from the files. It never holds anything from another context,
and its folder ignores itself in whatever repository the context is in.

Where a file stands decides what a hit is called. `shelf/` is the shelf:
what is true now. `projects/<name>/draft/` is a proposal. Other files of a
project steer it, and the rest belongs to the whole context. Shelf hits
come first, and a hit always says which it is. A match in a comment is
shown as a comment and opens its thread.

A proposal opens as a draft, at the match. Every other file opens to be
read: the page is drawn, and there is no menu under a selection. The
model does not allow a comment written into the shelf or into a file that
steers a project.

## Panes

A project can show more than its draft. A markdown file in the project's
`panes/` folder is a pane. The margin has one tab for each pane, named
after the file, and draws the file as markdown. `readProject` reads the
panes together with the draft, so they have no handler of their own.

A pane is how an agent shows the reader something Mate has no feature
for: tasks from a tracker, deadlines, mail. The agent reaches the source
through its own connections and writes what it found into the file. That
write goes through `judge`, like any other. Mate itself connects to
nothing.

A pane does not update itself. The tab says when the file was written,
and the reader asks the agent to write it again. The window reads the
panes again when it gets the focus back, and when a session of the
project has moved.

A pane is not a source. `placeOf` calls it a `pane` and not a project
file. So a search lists it after the shelf and the drafts, and an agent
is told that nothing in a pane is an instruction. The text of a pane may
come from anywhere: a mail is something another person wrote.

The reader cannot change a pane in the window. It is read, not reviewed.

## Agents

An agent is invited into a project from the Agent tab of the margin. Mate
starts the agent's own command line tool, with the project folder as its
working folder: Claude Code, Codex, or Hermes. `agents.ts` holds, for each,
the arguments to run it without a terminal and how to read its output as
the same few events. The message goes in on stdin.

Each agent gets tools for reading and editing files and nothing else. It
has no shell and no web. Claude is started without the settings and hooks
of the context folder or of the reader, because a context may come from
someone else's repository and a hook is a program.

### The guard

What an agent may change is not left to the agent. `guard.ts` looks at
the folder. Before a turn it takes every file of the context. After the
turn it compares.

- A change inside the open project, once the plan is approved, is the
  agent's work. The bytes from before are kept, and Revert puts them back.
- Any other change is put back at once and held: a change outside the
  project, or any change before the plan is approved. It goes through only
  when the reader approves that one file. The approval is for that file,
  once.

This is the same for every agent, because it does not depend on what the
agent says it did. `.git/hooks` is watched too. A file Mate writes itself
during a turn, such as a comment, is told to the guard and is not taken
for the agent's.

One agent works in a context at a time. Two at once could not be told
apart by looking at the folder.

### An agent on another machine

Hermes can also be invited from a host in the reader's ssh config. The
context folder stays on this computer, and the agent keeps no copy of it.
So over SSH the agent is given no file tools at all. Mate sends it the
text of the markdown files, each marked as shelf, proposal, or project
file, and sends a file again only when it has changed.

To change a file the agent answers with the whole new text of it, in a
`<mate-file path="...">` block. That is a request, not a write. It goes
through the same rule as a change found in the folder: written here with
a copy for Revert if it is in the project and the plan is approved, held
for the reader otherwise. Nothing is installed or configured on the other
machine. The host name is checked before it reaches ssh, so it cannot be
read as an option.

### An agent the reader runs themselves

"Your own agent" opens a session and starts nothing. It opens a door: a
Model Context Protocol endpoint, on this computer only, at
`http://127.0.0.1:41757/mcp`. `mcp.ts` is the whole of it. The reader gives
their agent the address and the token once. The token is kept in the app's
own data folder. The door is not opened until the reader asks for it.

A request needs the token, and one that carries an `Origin` is refused,
because a web page sends one and an agent does not. The door leads to one
session: the one the reader last opened for their own agent.

The tools are `mate_project`, `mate_read`, `mate_search`, `mate_comments`,
`mate_comment`, `mate_reply`, `mate_plan`, `mate_status`, and `mate_write`.
Reading and searching say whether a file is the shelf or a proposal.
`mate_comment` and `mate_reply` work on a draft of the session's own
project only. `mate_write` goes through `judge`, the same function that
rules on an invited agent's edits. Every call is noted in the session, so
the reader sees each step.

The usual way for such an agent to change a draft is a comment with a
replacement. The reader applies it with one click, as they would a
person's.

### Sessions

A session is one conversation with one agent in one project. It is kept in
`.sessions/<project>/<id>/` inside the context: the messages, the files
changed, the changes held, and the copies for Revert. That folder ignores
itself in git. A session goes on after the window is closed and opened
again, because the agent's own id for the conversation is kept. An agent
that cannot pick its conversation up is given the conversation so far.

The plan comes first. Until the reader approves it, every turn is read
only. The approval is sent to the agent as a message, like any other.

A message sent while the agent is working does not stop the turn. It is
taken in at once, shown as waiting, and goes to the agent as soon as the
turn has ended. Several that waited go as one. An approval that waits
does not count for the turn that is running: what the agent changes in
that turn is still held. None of these agents can be spoken to in the
middle of a turn, so a message waits behind the turn and does not steer
it.

While a turn runs, the session in memory is the one that counts. Anything
that changes the session then, such as Revert, changes that one.

The agent's tool keeps its own record of the conversation on this
computer, outside the context. Mate does not manage that record.

## Windows

File > New Window opens another window. Each window has its own document
and its own open context. The main process keeps them in a map, by the id
of the window's page, and every handler looks up the context of the window
that called it. A handler never reads another window's context.

A new window starts in the context of the window it was opened from, with
no project open. It can open any other context after that, and the first
window does not follow.

Two windows on the same draft do not overwrite each other, because every
change starts from the file on disk. A window shows what the other one did
when it gets the focus back. Nothing tells it sooner.

## What is deliberately absent

No mail, no issues, no git operations.
