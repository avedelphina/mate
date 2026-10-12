# Model

Mate is a desk for a body of work, arranged so an agent can be invited
later. The folders are the product. An application, if it comes, only
renders them.

## Three levels

**Context.** A world of knowledge. It holds a shelf of what is currently
true, a dropbox for material that belongs to the world, and the projects
inside it. It has no intents, no principles, and no actions. You cannot
work at this level. Opening a context means picking a project.

**Project.** The only place work happens. It has its own folder, a working
copy, a dropbox, intents, and principles. Intents steer and are never
finished. Principles are the rules of engagement and are not traded away
to ship faster.

**Session.** A conversation inside one project. Many sessions per project
is normal. Sessions do not share a transcript. They share the project
folder and, through it, the rest of the context.

## Knowledge

Context knowledge is the shelf. Projects treat it as the current reference.
It changes only when someone publishes.

Project knowledge is the work: drafts, comments, findings. It may be
unfinished or wrong. Other projects do not treat it as true.

Publishing turns a draft into the shelf copy. Saving does not. A newer
draft never wins because it is newer.

## Reading and writing

Inside one context, projects are connected. An agent invited into a project
may read the whole context, including sibling drafts, so it can say "this
proposal would force that document to change." It says which source is the
shelf and which is a proposal.

The finding is written in the open project. Writing to a sibling file, or
to the shelf, waits for an explicit approval that names that file. The
approval is once. It does not grant further writes.

Nothing is read or written across contexts. If two efforts must not see
each other, they are two contexts.

## What this repository does not contain

`apps/desktop` is a window onto this tree. It opens a context, opens a
project, writes review comments back into the draft, searches the context,
and lets an invited agent work in the project. No tracker, no mail. Those
can sit on top of this tree later. The index is rebuilt from the files and
is safe to delete.

Review comments use the marker format of
[md-redline](https://github.com/dejuknow/md-redline), stored in the
document they refer to.
