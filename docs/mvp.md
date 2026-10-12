# MVP

The first usable slice. One window, one context, one project, one draft.
You open a context, open a project, read the draft, and write a comment
back into the file. The comment survives closing the app.

Out of this slice, even if the model already describes them: agent, index,
mail, calendar, issues, a second window, the right-hand sources, drag
between projects, publish to the shelf.

## Done when

1. `pnpm install` from the repo root finishes.
2. `pnpm test` passes.
3. `pnpm typecheck` passes.
4. `pnpm build` finishes.
5. `pnpm dev` opens a window.
6. Opening `contexts/_example` lists `document-review` and `sibling`.
7. Opening `document-review` shows `draft/document.md`, plus its intents
   and principles.
8. Adding a comment changes `draft/document.md` on disk, and the comment
   is still there after quitting and reopening.

Steps 1 to 4 are verified. Steps 5 to 8 were driven in the real window on
2026-10-12, with scripted mouse and keyboard input against
`contexts/_example`, and again after the review slice in
[roadmap.md](roadmap.md) step 2 was built. The script cannot reach the
native folder picker in step 6, so it answered that dialog with the folder.
The dialog itself was clicked by hand on 2026-10-12, and it listed both
projects.

## Run it

```
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm dev
```

Node 22 or newer. pnpm 10 or newer. The root `pnpm-workspace.yaml` allows
build scripts for `electron` and `esbuild`. Without that, install succeeds
and the app has no binary.

If `pnpm dev` stops with `The requested module 'electron' does not provide
an export named 'BrowserWindow'`, the shell has `ELECTRON_RUN_AS_NODE` set.
A process started by VS Code inherits it. Unset it and run again.

If `node_modules/electron/dist` is missing after install, or after
`pnpm add`, run
`node node_modules/electron/install.js` with `ELECTRON_SKIP_BINARY_DOWNLOAD`
unset. On macOS, extract the cached zip with `ditto -xk`, not a generic
unzip. A generic unzip drops the framework metadata and the binary dies
on launch. Confirm with the binary's `--version`.

## What the click-through found

All four items that were left are done.

1. **Click through the window.** The preload was built as an ES module, and
   a sandboxed window cannot load one. `window.mate` was missing and every
   button failed. The preload is now built as CommonJS and loaded as
   `../preload/index.cjs`. If the window opens and nothing responds, that
   path is still the first place to look. A project that fails to open no
   longer leaves the previous draft on the page, and the message is the
   sentence the handler wrote, without the wrapper Electron adds.
2. **Line endings.** A new marker takes the line ending the file already
   uses. No existing line is rewritten.
3. **Pick the draft.** A project with several markdown files in `draft/`
   lists them and opens none until you pick.
4. **Select to comment.** Selecting a passage in the document fills the
   anchor. The passage may run over several lines. When the same words occur
   twice, the comment goes under the place you selected.

## Left to do

- [x] **Click the folder picker.** Press Open context, pick
  `contexts/_example` in the native dialog, and see `document-review` and
  `sibling` listed. This is the one part of step 6 the script did not
  exercise. Done by hand on 2026-10-12.

## Known limits

**The same words twice on one line.** A passage that occurs more than once
on the line it ends on cannot be commented by itself. Mate answers "Those
words occur more than once on that line. Select a little more." The marker
sits under a line and says nothing finer than that. Two such passages could
not be told apart later, and Apply could replace the wrong one. Select
enough around the words to make the passage the only one on its line.

**A marker inside a block, in other tools.** The marker is a line of its own
under the passage. Mate cuts markers out before it draws the page, so its
own page is whole. Another tool draws the file as it is: there, a marker
under one row of a table ends the table, and a marker inside a paragraph
splits it in two. The text is still all there.

**What the page does not draw.** Images are named, not loaded. Links are
not followed. HTML and entities such as `&amp;` are shown as written.

## Do not build yet

A second OS window, an agent, an index, mail, issues, or a way to publish
to the shelf. The model for those is settled in [model.md](model.md). The
implementation is not this slice.
