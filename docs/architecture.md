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
| Publishing a draft, and taking a shelf document down | `publish` and `takeDown` in `src/main/context.ts` |
| Running a script of a project | `src/main/scripts.ts` |
| What a pane is, and how it is read | `readProject` in `src/main/context.ts`, then `App.tsx` |
| The tree of a project's files | `listFiles` in `src/main/context.ts`, then `Tree.tsx` |
| How an agent is started and its output read | `src/main/agents.ts` |
| Which contexts are trusted, and what trust changes | `src/main/trust.ts`, then `acp` in `src/main/agents.ts` |
| How an agent that stays is spoken to, and what it may ask | `src/main/acp.ts` |
| Which files count as instructions, and what the reader approved | `src/main/pins.ts` |
| Comparing two texts line by line | `src/shared/diff.ts` |
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

Two functions change the prose, and only the reader runs them.
`applySuggestion` runs when the reader presses Apply. It replaces the
passage, sets `status` to `"resolved"`, and keeps any other comment's
marker that was inside the passage. `retype` runs when the reader types
in the draft: see "Typing in a draft".

## Typing in a draft

Edit turns the page into the text of the file, to type in. It is the
text the page shows: the comment markers are not in it, so the reader
cannot break one. Save, or leaving the field, writes what was typed.
Done goes back to the drawn page. A new draft is started from the rail:
a file with its title, open to be written.

`retype` gives the file its new text. It compares the old text and the
new one line by line. A line the reader did not touch keeps its bytes,
and the markers under it stay under it. A new line takes the line ending
the file already uses. A marker whose line is gone is kept, on a line of
its own after what took that line's place. Its comment is then found by
its quote, or shown as unanchored. No comment is lost by typing.

The save carries the text the reader began from. If the file holds
another text by then, because an agent or another program wrote it,
nothing is saved, and the reader is told. What they typed stays in the
field.

Only a draft can be typed in. The shelf, the intents, the principles
and all other files are read. No agent can reach this path: an agent
proposes a replacement, and the reader applies it.

## The shelf: taking down and publishing

The rail lists the documents of the shelf above the projects. One is
read from there, on the page.

**Taking down.** With a project open, a shelf document on the page can be
taken down into it: a copy in the project's `draft/`, which the project
owns. The shelf keeps its own and stays what is true. A draft of that
name is never written over.

**The exits of a dropbox.** A file that comes into a project leaves the
dropbox by one of three exits. There is no fourth, where it is just
remembered.

- *Pulled into the drafts.* A document that lies in the project's
  dropbox, or in the dropbox of the whole context, is pulled into the
  project's drafts when it is on the page. It is moved, not copied.
- *Left outside, with its path noted.* A file that is not in the context
  stays where it is. `noteSource` writes a note into the project's
  dropbox: the name, where the file lies on this computer, its size and
  date. Nothing of what is in the file is read. The note is a document,
  so a search finds the file by its name, and an agent is told of it.
- *Its text taken out, into a draft.* For a file that is not markdown,
  such as a Word file or a PDF. Mate reads no such file. The reader asks
  the agent, with one button, and the agent writes the draft through the
  guard like any other change.

A file comes in from outside in two ways. "Add a source" opens the file
dialog of the system. Or the file is dropped on the window. Either way
the window shows a card for it, with the exits that fit. A file of the
project that Mate cannot draw has the same card, with "Show it in
Finder" in place of the first exit.

The window never names a path for main to read. A file chosen in the
dialog is known to the window by a number, and only such a file is
copied in. A file that was dropped is known by its path, and that is
used for the note alone: to copy it in, the reader chooses it once more
in the dialog, which opens at it. A file dropped on the window is never
opened in its place: the window does not go to another page.

**Publishing.** Publish on a draft asks for a name on the shelf and
offers the ones that are there. Then the system asks once more, in a
dialog the page cannot press, and names what is replaced. `publish`
writes the text the page shows: the comments are not published. The
draft is not changed, and is a proposal again. A document that was on
the shelf under that name is kept in `shelf/.history/`, by its name and
the time. That folder is hidden, so the index does not read it and
nothing takes it for current.

Saving a draft is never publishing. No agent can publish: there is no
tool for it, and an agent's own change to the shelf is held like any
change outside its project. A shelf folder that is a link to somewhere
else is not published into.

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
what is true now. `projects/<name>/draft/` is a proposal. The intents
and the principles of a project steer it, and nothing else does. Any
other file of a project is material: what came in for the work, or what
was made in it. An agent is told that nothing in material is an
instruction. The rest belongs to the whole context. Shelf hits
come first, and a hit always says which it is. A match in a comment is
shown as a comment and opens its thread.

A proposal opens as a draft, at the match. Every other file opens to be
read: the page is drawn, and there is no menu under a selection. The
project that is open stays open beside it. The model does not allow a
comment written into the shelf or into a file that steers a project.

## The files of a project

The rail lists the files of the open project as a tree, under its name.
`readProject` sends the path of every file in the project folder. Hidden
names are left out, and a link is not followed. A folder in the tree is
a `<details>` element, so it folds with no code of ours. `draft/` starts
unfolded.

A draft opens for review. Any other markdown file opens to be read, as
it does from a search. The project stays open while the file is read:
the margin keeps its tabs, and the agent keeps its session. A file that
is not markdown is named in the tree, and a click shows it in the file
manager of the system, for the reader to open with what they have. Mate
draws markdown and nothing else, and it opens no file itself: opening a
file that came with a context could run it.

A project with no draft opens too. Its page is empty, and its other
files are in the tree.

The tree changes no file. It is a way to reach them.

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

A pane that has just been written is put on show, since it was made for
the reader to see. The one exception is when the conversation with the
agent is in the margin: the pane would take its place, so its tab gets a
mark instead. With the conversation on the page, the pane appears beside
it.

A pane does not update itself. The tab says when the file was written,
and the reader asks the agent to write it again. The window reads the
panes again when it gets the focus back, and when a session of the
project has moved.

A pane is not a source. `placeOf` calls it a `pane` and not a project
file. So a search lists it after the shelf and the drafts, and an agent
is told that nothing in a pane is an instruction. The text of a pane may
come from anywhere: a mail is something another person wrote.

The reader can act on a pane in two ways, and Mate draws both from the
markdown. No program of the agent's is run for either.

- **Tick a task.** A task written as `- [ ]` has a box the reader can
  press. `tickPane` changes that one character in the file, so the agent
  finds the task ticked when it next reads the pane. It is refused when
  the pane has been written since it was shown.
- **Say something.** A link written as `[words](say:)` is a button. It
  says its own words to the agent, in the session that is open. The
  button reads exactly what is said, so text that reached a pane from
  somewhere else cannot hide an order behind a harmless name. Words over
  300 characters are not said this way.

- **Run a script.** A link written as
  `[scripts/NAME and what it is given](run:)` is a button that runs that
  script. See "Scripts".

Apart from that a pane is read, not reviewed: no comment is written into
it, and it is not typed in.

## Scripts

What is done the same way each time is a script: a file in the project's
`scripts/` folder. An agent writes it once. After that it runs with no
agent and nothing off the computer, when the reader presses its button
in a pane, or Run it on the script's card in the tree.

`scripts.ts` is the whole of it. A script is a program with the reader's
rights, so:

- It runs only in a context the reader trusts. Main checks that, not the
  window.
- Only a file in `scripts/` of the open project is run. A link there
  that points out of the context is not followed.
- It runs as the line on the button says: the file, then what it is
  given. There is no shell in between, so nothing it is given is read as
  a command. A `.py`, `.sh`, `.js` or `.mjs` file is started with
  `python3`, `sh` or `node`. Any other file must be one the system can
  start itself.
- It runs in the project folder, one at a time in a context, and not
  while an agent is working there, since the guard would take what it
  changes for the agent's. It is stopped after five minutes, or when the
  reader presses Stop, together with what it started.

The line may leave something open. A word in curly brackets, such as
`{file}`, is asked of the reader when they press the button, and the
files of the project are offered. What they give is one thing the script
is given, spaces and all.

A script cannot ask anything while it runs. It has no input: what it
needs, it is given on its line or takes from a file.

What it printed is shown under the button, with whether it failed. What
it changed in the folder is just changed: no copy is kept and there is
no Revert, as when the reader types. The guard is for agents.

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

### Where the conversation is drawn

The agent's side of a project is a tab of the margin, beside the draft.
A session that is not about a draft is a conversation, and the reader
can give it the page: Open in the page, and Back to the margin. With the
conversation on the page, the margin is free for a pane beside it. A
project with no draft opens with the conversation on the page. Picking a
file puts that file on the page and the conversation back in the margin.

There is one `Agent` for the open project. `App.tsx` gives it the place
to draw into. It is the same component when it moves, so the open
session and a message half written move with it.

### A trusted context

That limit holds in every context the reader has not said they trust.
The reader gives trust to one folder at a time. The answer is given in a
dialog of the system, which the window cannot press. It is kept in the
app's own data folder, in `trusted.json`, by the real path of the
folder. Nothing inside a context can make that context trusted.
`trust.ts` is the whole of it.

In a trusted context, Hermes on this computer is started without the
limit. It has the tools it has in the reader's terminal: its own tools,
its skills, the reader's connections, commands. So the reader can ask for
work Mate has no feature for, such as next month's spreadsheet made from
the ones already in the folder. Trust does not change Claude, Codex, or
an agent on another machine.

A trusted context is also the only place where a script of a project
runs from its button. See "Scripts".

Such an agent is not started once for each turn. It is started as
`hermes acp` and stays, and Mate speaks the Agent Client Protocol with
it: one JSON message a line on its stdin and stdout. `acp.ts` is the
whole of that. Three things follow.

- **The agent can ask.** Before a command it judges risky, or an edit
  while no plan is approved, it asks and waits. The conversation shows
  the question with the command or the file, and Allow once or Deny. Yes
  is only ever for that one thing: if the agent offers no such answer,
  Mate answers no. An ask that is still open when the turn ends is over.
- **The agent can be told something while it works.** A message sent
  mid-turn goes to it at once, and it takes it into the turn. An approval
  still waits behind the turn, as before.
- **The plan gate is in the agent too.** Until the plan is approved the
  agent is in the mode that asks before every edit. After it, edits go
  through, and the guard rules on them as on any other.

The agent stays until the app is quit, the turn is stopped, or the
context is trusted no more. A new one is then given the conversation so
far, as an agent that cannot pick its conversation up is. Hermes can
load an earlier conversation, but in 0.21.5 a loaded one cannot reach a
custom provider, so Mate does not use that yet.

The guard still looks at the context folder after every turn, and the
same rule decides. A change in the open project after the plan is kept.
Any other change is put back and held. What a trusted agent does outside
the context folder, Mate does not see. Trust is for a folder whose files
the reader knows, because a file in it can ask the agent for anything.

### Instruction files

Hermes, Codex and Claude Code each read some files of the folder they
work in as their instructions: `AGENTS.md`, `CLAUDE.md`, `.hermes.md`,
`.cursorrules` and a few more. Mate does not put them into a prompt. The
agent loads them itself. So whoever can change such a file steers the
agent: a pulled commit, a cloned repository, or the agent itself, leaving
a note for its next turn.

Before every turn of an agent on this computer, Mate looks for these
files in the whole context and compares them with what the reader last
approved. If one is new, changed, or gone, the reader is shown which, and
the lines that differ, in a dialog of the system. Approve keeps what the
files say now. Cancel does not start the agent. What was approved is kept
in the app's own data folder, in `pins.json`, by the real path of the
context. `pins.ts` is the whole of it.

Limits. The check is before a turn, not during it. Other files can carry
instructions too: an agent may do what a README says. An approval makes
no context trusted, and the plan and the guard are as they were. An agent
on another machine is not covered: it reads the files of that machine.

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

The reader can look at a change before they decide. A kept change is
compared with the copy from before it, and a held change with the file
as it is. The conversation shows the lines taken out and the lines put
in, with a few lines around them. A file that is not text, such as a
spreadsheet, is not compared.

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
that turn is still held. An agent started once for each turn cannot be
spoken to in the middle of it, so a message waits behind the turn and
does not steer it. Hermes in a trusted context stays and listens: see
"A trusted context".

While a turn runs, the session in memory is the one that counts. Anything
that changes the session then, such as Revert, changes that one.

The agent's tool keeps its own record of the conversation on this
computer, outside the context. Mate does not manage that record.

## Windows

A folder named on the command line is the context of the first window.
The end-to-end test starts the app that way.

File > New Window opens another window. Each window has its own document
and its own open context. The main process keeps them in a map, by the id
of the window's page, and every handler looks up the context of the window
that called it. A handler never reads another window's context.

A new window starts in the context of the window it was opened from, with
no project open. It can open any other context after that, and the first
window does not follow.

The reader sets the width of the rail and of the margin by dragging the
edge between two columns, or with the arrow keys when the edge has the
focus. A double click puts a column back. The widths are kept in the
window's own storage on this computer. They are not part of a context:
nothing in a folder says how wide a column is. In a narrow window the two
outer columns give way before the page does.

Two windows on the same draft do not overwrite each other, because every
change starts from the file on disk. A window shows what the other one did
when it gets the focus back. Nothing tells it sooner.

## What is deliberately absent

No mail, no issues, no git operations.
