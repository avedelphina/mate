# Brief: review on the repo

For whoever builds the next slice. Read `docs/model.md`, `docs/architecture.md`,
`docs/mvp.md`, and `docs/roadmap.md` first. The rules below win where they
disagree with an assumption you would otherwise make.

## What to build

Step 2 of `docs/roadmap.md`. Open a markdown file that is already in a git
repository, select a passage, and leave a comment in the margin. The comment
is stored in the file as the marker step 1 already writes, so it commits and
pushes with the rest of the file.

The look comes from [markupmarkdown](https://github.com/jonradoff/markupmarkdown):
select the passage, the thread sits in the margin, a suggested replacement
has one button that applies it. The comment format comes from
[md-redline](https://github.com/dejuknow/md-redline): an invisible marker in
the file, the file stays the source of truth, an agent reads the comments
back later through MCP. We are not building the MCP part in this slice.

## What already exists

Commit `6693909` opens a context, opens a project, shows `draft/document.md`,
and writes one comment into it. The marker is written and parsed by
`apps/desktop/src/shared/comments.ts`. Keep that module. Extend it. Do not
replace it with a different marker format.

The window has not been clicked through by hand. `docs/mvp.md` lists the
four checks still open. Do those first and fix what breaks before adding
anything.

## Rules

- The file in the repository is the document. Mate keeps no copy of it, no
  database, no accounts, no server. markupmarkdown does all four. Do not
  copy that part.
- A comment whose quoted text no longer appears in the file is kept and
  shown as unanchored. It is not deleted. Re-anchoring it is a manual act.
- A suggested replacement is applied only when the button is pressed. Nothing
  edits the file on its own.
- Line endings stay as the file had them. `insertComment` currently splits on
  `\n`, which corrupts a Windows file. Fix that.
- A project with more than one markdown file in `draft/` shows the list.
  It does not silently open the first sorted name.
- Selecting text in the document fills the comment anchor. The user does not
  retype the sentence.

## Do not build

A second window, an agent, an index, mail, calendar, issues, drag between
projects, publishing to the shelf, the on-device model assist, the phone
PWA, the iPad app, the Hub. Each of those is a later step in `docs/roadmap.md`
and none of them is needed for the review to be useful.

## Done when

`pnpm test`, `pnpm typecheck`, and `pnpm build` pass, and the eight checks in
`docs/mvp.md` have been done by hand against `contexts/_example`. Commit on a
branch. Do not push to `main`.
