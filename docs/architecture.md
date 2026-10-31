# Architecture

The desktop app renders the folders described in [model.md](model.md).
The folders remain the product. Deleting the app loses no work, because
the work is the markdown.

## Process split

```
renderer (React)                preload                     main (Node)
App.tsx, Agent.tsx              window.mate                 index.ts
  openProject()      ---------> ipc 'project:open'   -----> readProject()
  addComment()       ---------> ipc 'comment:add'    -----> insertComment()
  sendMessage()      ---------> ipc 'session:send'   -----> one turn of the agent, then the guard
  onSession()        <--------- ipc 'session:update' <----- the session as the agent goes on
```

Every call has this shape. The whole of what the window can ask for:

| What | Channels | In main |
|---|---|---|
| The context | `context:open`, `context:create`, `context:shape`, `context:current`, `context:search`, `context:meaning` | the folder dialog, `createContext` after a dialog of the system, `shapeContext`, the projects, the index, `searchMeaning` |
| Git | `context:track`, `context:changes`, `context:commit` | `startRepository`, `uncommitted`, `commitContext` in `git.ts` |
| A file | `file:read`, `file:reveal` | a file that is read and not reviewed; a file shown in the file manager |
| A project | `project:open`, `project:create` | `readProject`: the draft, its comments, the panes, the tree; `createProject` |
| Comments | `comment:add`, `comment:reply`, `comment:apply`, `comment:anchor` | `insertComment`, `addReply`, `applySuggestion`, `anchorComment` |
| A draft | `draft:write`, `draft:create`, `draft:publish` | `writeDraft`, `createDraft`, and `publish` after a dialog of the system |
| The shelf | `shelf:list`, `shelf:take` | `listShelf`, `takeDown` |
| Sources | `source:pick`, `source:note`, `source:pull`, `source:copy`, `dropbox:pull` | the file dialog, `noteSource`, `copySource`, `copyFolder`, `pullIn` |
| A pane | `pane:tick` | `tickPane` |
| A script | `script:run`, `script:stop` | `runScript`, `stopScript` |
| Agents | `agents:list`, `agents:discover`, `agents:add`, `agents:remove`, `mcp:bind` | which agents can be invited; the hosts in the ssh config; the hosts added; the door for the reader's own |
| A session | `session:list`, `session:start`, `session:send`, `session:stop`, `session:answer`, `session:revert`, `session:settle`, `session:compare`, `session:models`, `session:tune` | `sessions.ts` |
| Trust | `trust:get`, `trust:set` | `isTrusted`, and `setTrusted` after a dialog of the system |
| Privacy | `privacy:get`, `privacy:set`, `privacy:opened`, `privacy:open`, `endpoint:get`, `endpoint:set` | `isPrivate`, and `setPrivate`: at once to keep a context private, after a dialog of the system to let agents in again; `setOpenedToEndpoint` after a dialog that names the host; `setEndpoint` in `endpoint.ts` |
| The assist | `assist:check`, `assist:run` | is the helper here; the helper, once for each question |
| Settings | `settings:get`, `settings:untrust`, `settings:close`, `settings:reveal`, and `settings:open` from the menu | the lists of `trust.ts`, `endpointView`, `meaningMissing`, `checkAssist`; only what takes away |

`session:update` is the one message that goes the other way: the session
as the agent goes on.

The renderer never imports `fs` and never sees a path it chose itself.
Every file operation goes through `context.ts`, which checks the path
stays inside the context before reading or writing. Where the reader
brings in a file from outside the context, they choose it in a dialog of
the system: see "The shelf: taking down and publishing".

Five things are decided in a dialog of the system, which the page cannot
press: trusting a context, letting agents into a private one again,
opening a private one to the reader's endpoint, approving instruction
files, and publishing.

`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
Do not relax these to make a feature easier. A sandboxed window cannot
load an ES module as its preload, so `electron.vite.config.ts` builds the
preload as CommonJS. Leave that as it is.

## Where a change goes

| Change | File |
|---|---|
| Comment marker format | `apps/desktop/src/shared/comments.ts` |
| Comments on a file that is not markdown, kept beside it | `combine` and `separate` in `src/shared/comments.ts`, then `textFileAt` and `editDraft` in `src/main/context.ts` |
| Reading a project, writing the draft, path check | `apps/desktop/src/main/context.ts` |
| Typing in a draft without losing a comment | `retype` in `src/shared/comments.ts`, then `writeDraft` in `src/main/context.ts` |
| A new capability the window can call | `src/main/index.ts`, then `src/preload/index.ts`, then `src/renderer/src/env.d.ts` |
| Layout | `src/renderer/src/App.tsx` and `styles.css` |
| How markdown is drawn | `src/renderer/src/markdown.ts`, then `styles.css` |
| What the assist is asked | `src/main/assist.ts` |
| What is indexed, how a search ranks | `src/main/contextIndex.ts` |
| Publishing a draft, and taking a shelf document down | `publish` and `takeDown` in `src/main/context.ts` |
| How a file comes in, and the exits of a dropbox | `pullIn`, `noteSource`, `copySource` and `copyFolder` in `src/main/context.ts` |
| Running a script of a project | `src/main/scripts.ts` |
| Search by meaning: passages, vectors, the model | `src/main/meaning.ts` |
| Which files have a text twin, and how it is made | `src/shared/twin.ts`, then `src/main/twins.ts`, and `--pdf` in `assist/main.swift` |
| Starting a repository, and committing | `src/main/git.ts`, and who may in `src/main/index.ts` |
| What a run button leaves open, and how it is filled | `src/shared/run.ts` |
| What a pane is, and how it is read | `readProject` in `src/main/context.ts`, then `App.tsx` |
| What the reader can press in a pane | `tickPane` in `src/main/context.ts`, then `Rendered.tsx` |
| The tree of a project's files | `listFiles` in `src/main/context.ts`, then `Tree.tsx` |
| How an agent is started and its output read | `src/main/agents.ts` |
| Which contexts are trusted, and what trust changes | `src/main/trust.ts`, then `acp` in `src/main/agents.ts` |
| Which contexts are private, and where an agent is refused there | `privacyAllows` in `src/main/trust.ts`, then `startSession` and `sendMessage` in `src/main/sessions.ts`, and `callTool` in `src/main/mcp.ts` |
| The reader's own endpoint: the relay, the sandbox, Mate's Hermes profile | `src/main/endpoint.ts`, and `private` in `src/main/agents.ts` |
| How an agent that stays is spoken to, and what it may ask | `src/main/acp.ts` |
| The model and the thinking effort of a conversation | `listModels` and `tuneSession` in `src/main/sessions.ts`, then `Tune` in `Agent.tsx` |
| Which files count as instructions, and what the reader approved | `src/main/pins.ts` |
| Comparing two texts line by line | `src/shared/diff.ts` |
| What an agent may change | `src/main/guard.ts`, then `src/main/sessions.ts` |
| What an agent is told at the start | `RULES` in `src/main/sessions.ts` |
| What an agent of the reader's own can do | `src/main/mcp.ts` |
| How the on-device model is called | `assist/main.swift` |
| Driving the built app in a test | `tests/e2e/drive.ts`, then `tests/e2e/smoke.e2e.ts` |

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

## Code, and any text file

Mate reviews code; it does not try to be a code editor. A text file of a
project is drawn as it is, with its line numbers beside it: they come
from an attribute of the block and are drawn by CSS, so they are not in
the page's text, which stays the file's. Lines do not wrap, so a number
stays with its line. *Open in editor* opens the document in the reader's
editor at the line of the active comment or the selection: the command
is set in Settings (`code -g` takes `FILE:LINE`), and without one the
system's own app opens the file. For a draft, the line counts the marker
lines above it (`fileLineOf`). The editor is the reader's own program,
started on their press with the file and nothing else; the file is
checked to be in the context. There is no syntax colouring, completion,
language server or terminal: scripts and agents run things, and the
reader's editor is a click away.

## Comments on a file that is not markdown

A file of a project that is text and not markdown, such as an XML config,
a CSV or a log, is reviewed like a draft. Text is told by the bytes, not
the name: UTF-8 with no zero byte, up to 2 MB. Scripts are left to their
card. Such a file is named by its path in the project, which a draft's
name, always markdown, cannot be, and it is drawn as it is, in one
block, with the comments' marks (`plain` in `Rendered.tsx`). It is not
published.

A marker in the file itself would break a CSV or a JSON file and show in
every other tool, so the comments are kept beside it, in
`NAME.comments.md`: the markers alone, each with a `line` field naming
the line of the file it sits under. `combine` in `comments.ts` puts them
back between the file's lines, and every function of the markers works
on the two together as on a draft; `separate` takes them out again and
gives the file back to the byte. In `editDraft`, a comment, a reply or a
new anchor writes only the side file. The file itself is written when
what it says changed: a suggestion applied, or the reader typing in it.
A marker whose line is gone is put after the last line, and its comment
is found by its quote, as in a draft.

The side file is a markdown file of the project: agents are told what it
is and read it with the file, and the search finds it, so a comment's
`#tag` finds every comment that has it. It is not a draft of its own.

In the margin, the words of a comment or a reply name things: `[[a
file]]` opens it when it names one file of the project (`fileNamed`, as
in an agent's answer), and a `#tag` searches the context for it. A
search hit in a side file opens the file it comments on, at its thread.

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
  such as a Word file or a PDF. The reader asks the agent, with one
  button, and the agent writes the draft through the guard like any
  other change. Mate's own text of the file, its twin (see "Text
  twins"), is plain text for search and reading. The agent makes a
  draft of it, with its headings and its form.

A folder from outside has one exit of its own. `copyFolder` copies it
into the project whole, with its folders, under its own name, as
material: the text twins and search by meaning then read it. Hidden
files and links are left out, so no `.git` folder comes in and nothing
leads out of the context. A folder named like one the project keeps for
itself (`draft`, `dropbox`, `panes`, `scripts`) is refused, and so is
one while an agent works, whose turn would take its files for the
agent's.

A file or a folder comes in from outside in two ways. "Add a source"
opens the file dialog of the system. Or the file is dropped on the window. Either way
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

A page, a pane, an answer of an agent, the intents and the principles are
each drawn inside a `Boundary`. If one of them cannot be drawn, the
reader sees which one and why, and the rest of the window goes on
working. It is tried again when its text changes. One more stands around
the whole window, so that no fault leaves it blank.

Selecting a passage opens a small menu under it: Comment, Rewrite, Remove.
The form then opens in the same place. Both are drawn beside the page
element, never inside it. Anything put inside the page becomes part of
the text a selection is measured against.

## The assist

The form under a selection has one more button where a local model is
available: Draft the rewrite, or Draft the note. `src/main/assist.ts`
decides what to ask, so the wording is in one place and has a test.

On a Mac, Electron cannot call the Foundation Models framework, so a small
native helper does. `assist/main.swift` is the whole helper. It takes one
question on stdin, gives one answer on stdout, and keeps no state.
`pnpm build:assist` compiles it to `assist/mate-assist`, which is not
committed. Linux instead asks Ollama's local chat API for `qwen2.5:3b`;
`MATE_OLLAMA_MODEL` names another model. Mate never installs Ollama or
pulls a model itself.

Where the model cannot answer or is not installed, the button is off and
says why. Windows has no assist. The model's text goes into the form. It
reaches the file only when the reader presses Add, as any comment does.
Nothing leaves the computer.

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

## Text twins

Much of a context is not markdown: policies as PDF, drafts from Word. So
that search, the page and agents can read them, Mate takes their text
out once and keeps it: the *twin* of `shelf/policy.pdf` is
`.indexes/text/shelf/policy.pdf.txt`. `twins.ts` is the whole of it, and
`src/shared/twin.ts` says which files have one.

- **What takes the text out.** A process of its own, and nothing leaves
  the computer. On a Mac a PDF is handed as bytes to Mate's helper, which
  asks PDFKit; a page with no text is drawn at three times its size and
  read with Vision. Word, RTF, ODT and HTML go to `textutil`. On Linux,
  `pdftotext` reads a PDF, and one without text is rendered by `pdftoppm`
  and read by Tesseract. LibreOffice converts DOC/DOCX, RTF, ODT and HTML
  in headless mode with an isolated temporary profile. It does so for
  every such file of every context, trusted or not, as soon as the
  context is open: a document made to break LibreOffice's parser runs
  against it with the reader's rights. `textutil` on a Mac does the same
  job with a far smaller parser. Kept so, by choice: reading only in a
  trusted context would leave Word files unfound in the rest. Python's standard
  library reads the HTML in a `.webarchive`. On both, an Excel workbook is
  a zip of XML files read by `unzip`, and each sheet becomes a markdown
  table. A CSV or TSV file is its own text: UTF-8, or else Windows-1250.
  These Linux tools are external dependencies, not bundled. A missing one
  leaves its files untwinned until it is installed. Mate starts no program
  or macro contained in a file.
- **When.** In the background, when a context is opened and at every
  search. Nothing waits for it. The rail says how many files are still to
  be read, and the search runs again when they are. A twin is made again
  when its file is newer, and taken away when its file is gone.
- **What it is.** A helper, like the index: plain text, in a folder that
  ignores itself in git. Deleting it loses nothing. A file that cannot be
  read, such as a locked PDF, gets an empty twin, so it is not tried
  again until it changes.
- **Who reads it.** The index takes a twin in as the text of its file, so
  a hit names the PDF or the Word file and its kind, such as the shelf.
  The window reads a twin in place of its file, with Show the original.
  Agents are told where twins are, and the MCP door reads one when asked
  for its file. Only the twin is read: a file of another kind is still
  shown only in the file manager.

Limits. A scan is read in Czech and English by Vision or Tesseract. The
Czech model reads Slovak but for a letter or two, such as Ľ. Handwriting
is not read. Slides, `.xls` and Numbers files have no
twin yet. A workbook gives the values of its cells: a formula gives the
value it last had, and a date the number Excel keeps for it. Any other
twin is plain text: headings, tables and pictures are gone. Up to 50 MB a file, 2 MB of text.

## Settings

What the reader has set is kept in the app's data folder, one small file
each: `trusted.json`, `private.json`, `opened.json`, `endpoint.json`
(the key sealed by the keychain) and `pins.json`. It stays from one
start to the next; the installed Mate and Mate Dev keep separate
folders. A context is known in these by its real path.

*Settings…* in the app menu (Command/Ctrl+,), or in the palette, puts them
on one page in the center, like a question: the endpoint, with its form;
the contexts trusted; the private contexts, and which are open to the
endpoint; whether search by meaning and the comment box's helper can be
had on this computer; and the folder, to show in the file manager. From
the page a setting can only be taken away: *Stop trusting*, *Close it to
your endpoint*. Trusting a context, or letting an agent or the endpoint
into a private one, is done in that context, behind a dialog of the
system. A folder the window names is acted on only when main holds it
already.

## A private context and the reader's endpoint

A private context lets no agent in. The reader may open one to a single
agent: Hermes on their own inference endpoint, an OpenAI-compatible
address such as `https://their-server/v1`. `endpoint.ts` is the whole of
it, and three things together keep the text from going anywhere else:

- **The sandbox.** On a Mac, `sandbox-exec` denies every connection out
  but Mate's TCP relay on `127.0.0.1`. Linux runs Hermes under Bubblewrap
  with `--unshare-net`: it has no network device but loopback. A small
  Python bridge in the sandbox listens there and forwards only to Mate's
  relay over a Unix socket shared from the host. A Unix socket is not
  network, so `--unshare-net` alone would leave every one on the host
  open: the D-Bus session bus, an ssh connection, a Docker socket. The
  system is seen read-only, `/tmp`, `/run`, `/var/tmp` and home are empty,
  and the variables that name such sockets are dropped. Only the context,
  the `mate-private` profile, Hermes's runtime and the relay's socket are
  bound back. Socket files already in the context are masked by `/dev/null`.
  The bridge is `assist/linux-relay.py`, packaged with Mate; Bubblewrap
  and Python are external dependencies.
- **The relay.** A server in Mate, on TCP and a Unix socket, that passes
  requests under `/v1` to the endpoint the reader set, and to nothing
  else. It needs a token that Hermes holds, refuses a request with an
  `Origin` header, and adds the endpoint's key itself. Hermes and the
  Python bridge never see the key.
- **Mate's own Hermes profile.** `mate-private`, in Hermes's profiles,
  written again before every turn: the relay as its only provider, no
  fallback providers, no plugins, no memory, file tools only. A standalone
  gateway in that profile keeps current Hermes off the reader's default
  gateway, which may fall back to a provider in the cloud.

The key is kept in `endpoint.json` in the app's data folder, sealed by
Electron's `safeStorage` (the system keychain). On Linux a keyring must
run, such as GNOME Keyring or KWallet: without one Electron would seal
with a password every computer knows, so Mate keeps no key there. The window is told the
address, the model, and whether a key is saved, never the key. The
address must be https, unless it is on this computer.

Saving the endpoint asks nothing. Opening a private context to it asks in
a dialog of the system that names the host. A new host closes every
context that was opened to the old one. Closing a context to the
endpoint, or making it not private, closes it again.

Limits. `sandbox-exec` is deprecated by Apple, and still works. Linux
needs Bubblewrap with user namespaces permitted by the system. Hermes
writes only to the `mate-private` profile and its dependency launch locks
there: a version that writes elsewhere under the home fails. An abstract
Unix socket has no path to hide or mask and remains a limit. Hermes needs
a model with tool calls and a window of 64,000 tokens or more. The agent
is Hermes alone; Claude and Codex are not offered in a private context.

## Search by meaning

Words find what is written in them. A question in other words, or in
another language, needs the meaning. Each document of a context, PDF and
Word files by their twins, is cut into passages of about a page, at
paragraphs. Each passage gets a vector from an embedding model, with the
title of its document. A question gets one too, and the passages closest
to it are found. `meaning.ts` is the whole of it.

- **The model** is bge-m3, run by Ollama on this computer. On a test of
  fifteen questions in English, Czech and Slovak, most of them aimed at a
  passage in another language, it put the right passage first every
  time. Apple's on-device model, which needs nothing installed, did so
  twice. Mate talks only to `127.0.0.1`, so nothing leaves the computer.
  Without Ollama and the model there is no search by meaning, the search
  says what is missing, and nothing else changes.
- **When.** In the background, after the twins: a file gets its vectors
  again when it changed, and loses them when it is gone. The rail says
  how many files are left. A passage takes about 75 ms, so a large
  context takes a while the first time, and seconds after.
- **What is kept.** `.indexes/meaning.json`: for each file its passages
  and their vectors, one byte for each dimension. A helper like the
  index: made again from the files, safe to delete.
- **What is shown.** Under the hits by words, the passages close enough
  in meaning, the closest first, up to eight. A hit opens its file at the
  passage. A question nothing in the context answers finds nothing.
- **A question on the page.** Enter in the search, or *See them whole*,
  asks for up to 24 passages, each with its whole text, and `Question.tsx`
  puts them on the page in place of the draft, grouped by document in the
  order of their closest passage, and in each document in the order they
  come. Each is drawn as markdown and opens its file at its place. Nothing
  is written by a model, so the reader sees only what the files say, and
  it works in a private context. Panes are left out: a pane is not a
  source.

Limits of asking this way. A passage that matters can score under the
bar: a draft that shares a budget with an agency scored 0.42 against the
rule on suppliers, and a passage of no use 0.43. Down there the model
cannot tell them apart, and a lower bar only brings more of no use.

**Judging by the reader's endpoint.** Where the reader's endpoint may
read the context (any context that is not private, and a private one
opened to it), the question view offers to ask it. Mate itself sends the
text asked about and the thirty passages closest in meaning, under the
bar too, to the endpoint's `/chat/completions`, with the key, and asks
for JSON only: the numbers of the passages that answer the text, set a
rule that applies to it, or contradict it, the most relevant first
(`judgeOnEndpoint` in `endpoint.ts`). No agent is involved, and nothing
the model writes is shown: the page shows those passages, the files' own
text, in its order. For *Near it* the selected passage is left out
before the judge sees it, since it would pick it first. A passage is
cut at 1,200 characters, so thirty fit a window of 16,000 tokens.
Tried with a small local coding model as a stand-in, it picked the right
document for a plain question and nothing for a passage of a draft: how
much this gives depends on the model behind the endpoint. The draft stays beneath, as it was, and is back when the
  question is closed (Esc).
- **Near a passage.** *Near it*, in the menu under a selection in a
  draft, asks the same with the selected text as the question, and
  leaves out the passage itself, which would find itself first.

**Agents search by meaning too.** `mate_search` on the MCP door gives the
passages close in meaning after the hits by words, each whole, with its
file and the characters where it is, so the agent can answer from it and
say where. An agent the reader connects to the door has it. An agent
Mate starts and that stays between turns, Hermes in a trusted context,
is handed a door of its own when it starts: a token for its session
that only reads. With it the agent can see the project, read, search and
see the comments, and nothing more: it writes with its own tools, as
before, and the guard rules on that. Its calls are not written into the
session, since the agent reports its own steps. Such tokens last as long
as the app; a token only reads a context that whoever runs as the reader
can read anyway.

Limits. Every passage is compared with the question: fine for some ten
thousand passages. Close enough is one bar, read off a small test, to be
tuned on real contexts. An agent started for one turn, such as Hermes in
a context that is not trusted, or Claude, gets no door: it reads the
files and the twins.

## The index and the search

A context has an index: `.indexes/context.json` inside the context folder.
It holds, for every file in the context, where the file stands, its
title, its text as the page shows it, and the text of its comments. A
markdown file is read as a document, a PDF, Word or table file by its
text twin, and any other by its own text when it is text: UTF-8 with no
zero byte, such as code, an XML config or a log. A file that is not
text is kept with no text, so it is not read again until it changes.
Search by meaning reads the same files, so code is found by meaning too;
a large repository brought in makes the first pass long.
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

## Starting a context and a project

A context is started where the reader says, in the save dialog of the
system: the window never names a folder for main to make. `createContext`
makes the folder with `shelf/`, `dropbox/` and `projects/` in it, all
empty. A folder that is already there is never made over. It is opened
instead, as any folder can be: one with no `projects/` is a context with
no projects yet.

A folder that is opened and has no `projects/` is not a context yet. The
rail says so and offers to make it one. `shapeContext` adds the three
folders where the folder stands, and what is in it stays as it is.

A context that is in no git repository has no history and no way to
another computer, and git is the only sync Mate has. The rail says that
too, and offers to start a repository. See "Git".

A folder the reader already has, often a git repository, is brought in
as a project with Bring in a project…: chosen in the folder dialog of the
system, then moved after a second dialog that says where to, and that it
is moved, not copied. `importProject` moves it as it is, to
`projects/<its name>/`, and writes nothing into it: no `draft/` folder,
no intents, no principles. A repository keeps its history and its
remote. Mate adapts to it instead:

- **Its drafts are where they lie.** A project with no `draft/` folder
  has its markdown files as its drafts, but the two that steer it and its
  panes. `draftsOf` and `draftHome` in `context.ts` say where a
  project's drafts are, and every path that reads, writes, comments on or
  publishes a draft goes through them. A new draft, a document taken
  down or pulled in, goes where the others are. The index calls such
  files proposals.
- **Its repository is its own.** A commit of the context leaves out any
  project that has a `.git` of its own: its history is not taken into
  the context's.
- **What git runs in it is guarded.** The guard watches the hooks and the
  config of a project's own repository, as it does the context's, and a
  change to anything under a `.git` folder is held for the reader, plan
  or no plan.

It is not brought in while an agent works in the context, nor from
inside the context, nor from a folder that holds it. A folder on another
disk is not moved: the reader moves or copies it beside the context
first.

A project is started from the rail, by its name. `createProject` makes
`projects/<name>/` with a `draft/` folder, `intents.md` and
`principles.md`. The two files say what they are for and nothing more,
so an agent that reads them is told nothing the reader did not write.
The name is a file name: letters and numbers first, and nothing that
could be a path. A project of that name is never written over, and a
`projects/` folder that is a link to somewhere else is not written into.

## Git

Git is how a context has a history and moves between computers. Mate
does three things with it, and `git.ts` is the whole of them.

- **Start a repository.** `startRepository` runs `git init` in the
  context folder, when the reader presses the button.
- **Commit.** `commitContext` puts what has changed in the context into
  one commit, in the reader's words. The foot of the rail has the button.
  How many files there are is asked of git when the reader goes to
  commit, and is not kept.
- **Show a file's history.** *History*, in the bar of an open document,
  lists what changed since the last commit and each commit that changed
  the file, newest first, each with what it changed. `historyOf` runs
  `git log -- FILE`, from the file's own folder, so a project that is a
  repository of its own answers for its files. `versionAt` runs `git
  cat-file blob REV:./FILE`, which gives the bytes as stored: no filter
  and no text conversion. Mate diffs two versions itself, with the line
  diff an agent's changes are shown with, so no diff program a repository
  names is run. A revision is taken only as a hash, a hash with `^`, or
  `HEAD`.

A commit is the reader's act, like publishing. Nothing is committed for
them, at no moment and by no rule: a commit made on its own would take
text that is half written, or what an agent has just changed and the
reader has not looked at.

Git starts programs a repository names: its hooks, and whatever its
config says, such as a filter or a signing program. A context must not
be able to run a program, so:

- Whether a folder is in a repository is seen by looking for `.git` in
  it and in the folders above it. Git is not asked.
- `git init` is run only where there is no repository. A new one holds
  nothing but what git put there, so this is done in any context.
- Everything else, counting what has changed, committing and reading a
  file's history, is done only in a context the reader trusts. Main checks that, as it does for
  a script. Switching the hooks off for one command would not be enough:
  the config can name other programs, under names Mate cannot know.
- Neither is done while an agent works in the context. The guard watches
  `.git/config` and the hooks, and a commit in the middle of a turn
  would take what the agent is in the middle of.

A commit takes the context and nothing beside it. In a repository that
holds more than the context, what else was changed or staged there is
left as it was. What Mate keeps for itself, `.indexes/` and `.sessions/`,
ignores itself and is not committed.

No remote is added, and nothing is pushed or pulled. Those bring
credentials and conflicts, and they are what git's own tools are for: a
terminal, or an agent in a trusted context.

The copy for Revert is not git. A change by an agent is put back from
the copy Mate took before it, whether or not anything was ever committed.

A context is renamed by clicking its name in the rail, and the open
project with Rename project… under it, or from the palette. The folder
is renamed where it stands, and all that is in it goes with it. For a
project its sessions are moved and told their new project, and its text
twins and learned passages move too, so nothing is read or learned
again. A context keeps its trust and its approved instruction files:
they were given to the folder, and follow it to its new name. The old
path is trusted no more. Nothing is renamed while an agent works in the
context or Mate is still reading its files, and an agent that stayed
between turns is sent away first: it works in a folder that will not be
there. It starts again with the conversation so far.

## The files of a project

The rail lists the files of the open project as a tree, under its name.
`readProject` sends the path of every file in the project folder. Hidden
names are left out, and a link is not followed. A folder in the tree is
a `<details>` element, so it folds with no code of ours. `draft/` starts
unfolded. Each level stands a step in, with a line down its side, and the
project is the root of its own tree.

A draft opens for review. Any other markdown file opens to be read, as
it does from a search. The project stays open while the file is read:
the margin keeps its tabs, and the agent keeps its session. A file that
is not markdown is named in the tree, and a click shows its card, with
what can be done with it, and Show it in Finder for the reader to open it
with what they have. A PDF or a Word file is read on the page as well, as
its text twin. Mate draws markdown and nothing else, and it opens no file
in the program that made it: opening a file that came with a context
could run it.

A project with no draft opens too. Its page is empty, and its other
files are in the tree.

The tree changes no file. It is a way to reach them.

Above the projects, the rail lists the rest of the context the same way:
the shelf, and under Context whatever is neither on the shelf nor in a
project, such as the context's own dropbox. A markdown file there opens
to be read, a PDF or a Word file as its text, and anything else is shown
in the file manager.

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

An agent is invited into a project from the Agent tab of the margin. Agents on this
computer are found on the PATH. An agent on another machine is offered only
once the reader has added its host in Settings: a look in the ssh config
(`discoverAgents('ssh')`) adds nothing, and the reader picks, or types a
host. Those are kept in `agents.json` in the app's data folder, outside every
context. Mate
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

A file the agent names in its answer opens from there, when the name is
written as code and names exactly one file of the open project: by its
path from the project, by its path from the context, or by its name
alone. `fileNamed` in `src/shared/named.ts` decides. Only a file the
project lists is opened, so an answer cannot send the window anywhere
else. A name written as plain words is not a link.

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

Kimi is the one agent that has no limit to start with: `kimi acp` takes no
list of tools, and ignores the agent file that `kimi -p` obeys. So it is
started in a trusted context only (`trustedOnly` in `agents.ts`), over ACP, so
the message goes in on stdin. Before the plan is approved it is in its own
`plan` mode, which runs no tool but a read and saves the plan under its
sessions. It ends the plan with an ask titled `ExitPlanMode` that holds the
plan: Mate puts the text into the answer, where the reader approves it, and
says no with `plan_reject_and_exit` (`planAsk`), because "revise" makes it
send the plan again and again. After approval it is in `default`, which asks
before every step but a read: its `auto` mode runs a shell and the web
unasked. Mate says yes to an ask titled `Write` or `Edit` (`edits`) and
passes the rest to the reader. It cannot be steered, so a message sent while
it works waits behind the turn. Its models and its thinking (`low`, `high`,
`max`) are options of the conversation, set with `session/set_config_option`.
When it asks a question (`AskUserQuestion`) it sends one ask with several
options that say yes once, and one that says no (skip). That is a question:
the ask carries `choices`, the window shows them as buttons, and the answer
is sent as that option. A choice that is not one of the options is a no.

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
  still waits behind the turn, as before. The reader can also send a
  message with After this turn: it then waits for the turn to end, as it
  would with any other agent, and does not change what the agent is
  doing now.
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

### The model and the effort

Under the message to Hermes on this computer, the reader chooses the
model it thinks with and how hard it thinks. The choice is kept in the
session and holds from the next turn on.

- **The list is Hermes's own.** Mate keeps no list of models. The first
  time the reader opens the choice, Hermes is started once in a folder
  that is nobody's, asked what it offers, and sent away. Until then
  nothing is asked, because Hermes may look its models up on the network.
- **A model's name is only ever read by Hermes.** It holds the provider
  too, and Mate does not take it apart. It is checked before it is put
  on a command line, where it must not read as an option, because a
  session file may carry any text.
- **Started for one turn**, Hermes is given both on its command line
  (`-m`, `--reasoning`).
- **An agent that stays** is told the model before the turn
  (`session/set_model`). When the reader gives the choice back, that
  agent is sent away, and a new one thinks with Hermes's own model again.
  Hermes 0.21.5 cannot be told an effort while it stays, so in a trusted
  context it thinks as hard as its own settings say, and the choice says
  so instead of offering one.

Claude and Codex take their model from their own settings, and so does
an agent on another machine, which has other models than this one offers.

### Instruction files

Hermes, Codex, Kimi and Claude Code each read some files of the folder they
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
A door that only reads, as Mate hands to an agent it starts, offers the
first four.
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

A turn is written down before the agent starts: the reader's message is
saved, and beside the session a note, `turn.json`, says which process
runs the turn and holds a mark for every file of the context as it was.
The note is taken away when the turn has ended and the guard has been
through the folder. A note that is still there when the session is next
read, with its process gone, is a turn that was cut off. The session then says so, and names
the files that are not as they were. Nothing can be put back: the copies
from before the turn were in the app's memory. Go on asks the agent to
take the turn up again. What the agent had answered so far is not kept.

Quitting while an agent works is the reader's call, asked in a dialog of
the system. *Let it finish*: the windows close, the app stays without
one until no agent is working, and then quits by itself. The guard goes
through the folder as after any turn, because the app is still there to
do it. An agent that asks before it does something is told no, since
nobody is there to say yes. A window opened again meanwhile means the
reader is back, and nothing quits. *Stop it*: the agents are stopped and
the app quits, and the turn is found cut off the next time.

An agent is never left running with the app gone. What it changed would
not be checked, and nothing of it could be put back. An agent that
outlives the app, with its changes checked when the reader comes back,
needs the copies from before the turn on disk and the agent's words in
a file: that is not built.

The agent's tool keeps its own record of the conversation on this
computer, outside the context. Mate does not manage that record.

The list of sessions shows, for each, a dot for where it stands (working,
may edit, still at its plan), what was first said in it, and who it is
with and when. The newest comes first.

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

Command/Ctrl+K opens the palette: one list of what the window can go to or do just
now, found by typing. The files of the open project, the shelf, the other
projects, the tabs of the margin, and what the buttons do. It is made
from the same functions the buttons call, so it adds no way to do
anything that has none. It is a dialog of the platform, which takes the
focus and closes on Escape.

The reader sets the width of the rail and of the margin by dragging the
edge between two columns, or with the arrow keys when the edge has the
focus. A double click puts a column back. The widths are kept in the
window's own storage on this computer. They are not part of a context:
nothing in a folder says how wide a column is. In a narrow window the two
outer columns give way before the page does.

Two windows on the same draft do not overwrite each other, because every
change starts from the file on disk. A window shows what the other one did
when it gets the focus back. Nothing tells it sooner.

## The app, installed

`electron-builder.yml` puts the app together for Apple silicon macOS and
x86-64 Linux: the built `out/` folder in one archive, the on-device helper
beside it in the resources on a Mac, and the icon. Linux is an AppImage
and a Debian package. Nothing is loaded from `node_modules` when it runs,
because the build already holds what main and the window import.

The only code that knows it is installed is in `index.ts`: the helper is
looked for in the resources, and a debugging port asked for on the
command line is refused. The program itself has three switches turned
off, where a command line cannot turn them on again: it does not act as
Node, it takes no Node options from the environment, and it takes no
inspector. It starts only the archive it was packed with.

It updates itself, in `update.ts`. Each release carries `update.json`,
in Squirrel.Mac's JSON form, and the app reads it from GitHub's address
for the newest release, when it starts and every six hours. On a Mac,
Electron's own updater downloads the zip it names and checks that it is
signed with the same Developer ID before it puts it in, when Mate quits.
On Linux, Mate reads only the version, and says when a newer one is out:
an AppImage or a package is put in by the reader. A checkout never
updates itself. Restarting into an update is refused while an agent
works.

Run from a checkout, the app has another name, Mate Dev, and with it
another folder for its data. A checkout can be driven through a debugging
port, and whoever drives it could use what it holds: the contexts the
reader trusts, the instruction files they approved, the token of the MCP
endpoint. So the two share none of these. See
[../apps/desktop/README.md](../apps/desktop/README.md) for the commands.

## What is deliberately absent

No mail and no issues of Mate's own: an agent shows them in a pane, and
Mate connects to neither. Of git, only a repository started and a commit
made, when the reader says so: no remote, no push, no pull, and no commit
made on its own. No program from a context
that runs in the window: a pane is markdown, and Mate draws its buttons.
