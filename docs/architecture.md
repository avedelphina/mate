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

No agent, no index, no mail, no issues, no git operations.
