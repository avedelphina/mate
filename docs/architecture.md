# Architecture

The desktop app renders the folders described in [model.md](model.md).
The folders remain the product. Deleting the app loses no work, because
the work is the markdown.

## Process split

```
renderer (React)            preload                    main (Node)
App.tsx                     window.mate                index.ts
  openContext()  ---------> ipc 'context:open'  -----> folder dialog, list projects
  openProject()  ---------> ipc 'project:open'  -----> readProject()
  addComment()   ---------> ipc 'comment:add'   -----> addComment()
```

The renderer never imports `fs` and never sees a path it chose itself.
Every file operation goes through `context.ts`, which checks the path
stays inside the context before reading or writing.

`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
Do not relax these to make a feature easier.

## Where a change goes

| Change | File |
|---|---|
| Comment marker format | `apps/desktop/src/shared/comments.ts` |
| Reading a project, writing a comment, path check | `apps/desktop/src/main/context.ts` |
| A new capability the window can call | `src/main/index.ts`, then `src/preload/index.ts`, then `src/renderer/src/env.d.ts` |
| Layout | `src/renderer/src/App.tsx` and `styles.css` |

Add the preload and the type in `env.d.ts` in the same change as the
handler. A handler the renderer cannot name does not exist.

## Comment markers

A comment is a line in the draft, directly under the line it quotes:

```
The sentence being discussed.
<!-- @comment{"id":"1","anchor":"The sentence being discussed.","text":"Why.","author":"you"} -->
```

`parseComments` scans for `<!-- @comment` and closes on the first `-->`
whose body parses as JSON with a string `anchor` and a string `text`.
A broken marker is left in the file and skipped. Do not replace this
with a regex: a regex cannot tell a broken marker's closer from the
real one and then swallows the next marker.

`insertComment` places a new marker after the markers already attached
to that line, never between the line and its first marker. Ids count up
from the highest id already in the file.

## Writing a file

`addComment` writes to a temporary file in the same directory and renames
it over the draft. Do not write the draft in place. A crash mid-write
would leave a half-saved document.

## What is deliberately absent

No agent, no index, no second window, no mail, no issues, no git operations.
The main process holds one `contextDir` for the whole app. That is enough
for one window and wrong for two. A second window needs the open context
stored somewhere other than one module-level variable.
