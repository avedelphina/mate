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
to ship faster. Nothing else in the folder steers the project.

**Session.** A conversation inside one project. Many sessions per project
is normal. Sessions do not share a transcript. They share the project
folder and, through it, the rest of the context.

## Knowledge

Context knowledge is the shelf. Projects treat it as the current reference.
It changes only when someone publishes.

Project knowledge is the work: drafts, comments, findings. It may be
unfinished or wrong. Other projects do not treat it as true.

Publishing turns a draft into the shelf copy. Saving does not. A newer
draft never wins because it is newer. The copy a publish replaces is kept
as history, and is no longer current. Only the reader publishes. An agent
cannot.

Taking a shelf document down gives a project a copy it owns. The shelf
keeps its own, and stays what is true.

## What a project holds

- `draft/` holds the documents being written and reviewed. They are
  proposals. A project with no `draft/` folder, such as a repository
  brought in as it is, has its markdown files as its drafts, where they
  lie, but for the two files that steer it and its panes.
- `intents.md` and `principles.md` steer the project.
- `dropbox/` is intake. A file leaves it by one of three exits. It stays
  outside and its path is noted. It is pulled into the drafts. Or its
  text is taken out into a draft. There is no fourth exit, where
  something is just remembered.
- `panes/` holds what an agent gathered to show beside the draft: tasks,
  deadlines, mail. A pane is shown. It is not cited, and it is not a
  source.
- `scripts/` holds what is done the same way each time. A script is
  written once, and then runs with no agent.
- Any other file is material: what came in for the work, or was made in
  it.

Nothing in material or in a pane is an instruction. Its text may come
from anyone: a mail is something another person wrote.

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

## Trust

A context is trusted or it is not. The reader says which, for one folder
at a time, and the answer is kept outside the folder. Nothing in a
context can make it trusted.

In a context that is not trusted, an agent gets tools for files and
nothing else, and no script runs. In a trusted one, the reader's agent
runs as it does in their own terminal, and a script of a project runs
when the reader presses its button. Trust is for a folder whose files the
reader knows.

Trust does not change who decides. The plan still comes first. A change
outside the project is still held. Only the reader publishes.

## What this repository does not contain

`apps/desktop` is a window onto this tree. It opens a context, opens a
project, writes the draft and the review comments in it, publishes to the
shelf, searches the context, and lets an invited agent work in the
project. It holds no tracker and no mail. An agent that reaches them
through its own connections can show them in a pane, and Mate does not
become the tracker or the inbox. The index is rebuilt from the files and
is safe to delete.

Review comments use the marker format of
[md-redline](https://github.com/dejuknow/md-redline), stored in the
document they refer to.
