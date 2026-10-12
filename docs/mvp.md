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

Steps 1 to 4 are verified. Steps 5 to 8 have not been done by hand yet.
The app binary launches and stays running; nobody has clicked through it.

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

If `node_modules/electron/dist` is missing after install, run
`node node_modules/electron/install.js` with `ELECTRON_SKIP_BINARY_DOWNLOAD`
unset. On macOS, extract the cached zip with `ditto -xk`, not a generic
unzip. A generic unzip drops the framework metadata and the binary dies
on launch. Confirm with the binary's `--version`.

## Left to do

In order. Each one is usable on its own.

1. **Click through the window.** Do steps 5 to 8 above and fix what breaks.
   The preload is loaded as `../preload/index.mjs` because that is what the
   build emits. If the window opens blank, that path is the first place to look.
2. **Line endings.** `insertComment` splits on `\n`. Preserve the line ending
   the file already uses, so a Windows file does not come back mixed.
3. **Pick the draft.** A project with two markdown files in `draft/` silently
   opens the first sorted name. Show the list.
4. **Select to comment.** The comment box asks you to type the sentence.
   Selecting it in the document should fill the anchor.

## Do not build yet

A second OS window, an agent, an index, mail, issues, or a way to publish
to the shelf. The model for those is settled in [model.md](model.md). The
implementation is not this slice.
