---
tags: tour/model
---
# Documents and the shelf

The shelf, in `shelf/`, is what is true now. [[how-a-context-works]] is on it.

A markdown file in a project is a document under review, a proposal. It lies where you put it: this
project has no special folder for them. Mate adds none, and you do not need one. A project that
already keeps its documents in a `draft/` folder works the same way.

## Try it

1. Press **Publish…** in this page's bar.
2. A dialog of the system asks you to confirm, and says what it replaces. It is the one place where
   something becomes true, so Mate does not let the window press it for you.
3. Cancel, unless you want a copy on the shelf. You can publish and then delete the tour.

When a document replaces one on the shelf, the old text is kept as history in `shelf/.history/`.

## Status

What a document is, is in its front matter: `status`. With none, it is a draft, and with
`status: final` it is finished, as [[start-here]] says of itself. The bar shows **Final**, and
**Publish…** is offered as the next step. Press **Properties…** and change `status` to see it. A status is
a note to yourself and to colleagues. It does not change what is true. Only the shelf does.

Next: [[fields-and-tags]].
