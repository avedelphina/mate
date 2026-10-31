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
unfinished or wrong. Other projects do not treat it as true. A draft can
say it is final, in its front matter as `status: final`: that is the
project's own finished result. It is still not the context's truth, which
only the shelf is. Most projects never need the shelf.

Publishing turns a draft into the shelf copy. Saving does not. A newer
draft never wins because it is newer. The copy a publish replaces is kept
as history, and is no longer current. Only the reader publishes. An agent
cannot.

Taking a shelf document down gives a project a copy it owns. The shelf
keeps its own, and stays what is true.

## What a project holds

- The documents being written and reviewed. A new project has no folder
  for them: its markdown files are its documents, wherever they lie, but
  for the two files that steer it, its panes, its dropbox and its scripts.
  They are the project's own work, and proposals against the shelf when
  published. A project may also keep a `draft/` folder, as one brought in
  as it is may: then only what is in it, folders inside it too, is a draft,
  and any other markdown file is material, which is reviewed too.
- `intents.md` and `principles.md` steer the project.
- `dropbox/` is intake. A file leaves it by one of three exits. It stays
  outside and its path is noted. It is pulled into the drafts. Or its
  text is taken out into a draft. There is no fourth exit, where
  something is just remembered. A folder from outside has one exit of
  its own: it is copied into the project whole, with its folders, as
  material.
- `panes/` holds what an agent gathered to show beside the draft: tasks,
  deadlines, mail. A pane is shown. It is not cited, and it is not a
  source.
- `scripts/` holds what is done the same way each time. A script is
  written once, and then runs with no agent.
- Any other file is material: what came in for the work, or was made in
  it. It can be reviewed, with its comments kept beside it, but it is not a
  proposal and is not published. Move it into `draft/` to make it one.

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

## Privacy

A context can be kept private. Then no agent works in it, so nothing of
it leaves the computer. Everything else still works there: search, by
meaning too, the text of PDF, Word and Excel files, scripts, commits, and
the comment box, which asks the model on this Mac. The answer is kept
outside the folder, like trust. Keeping a context private asks nothing.
Letting agents in again is the reader's to say, in a dialog of the
system.

A private context can be opened to one agent: Hermes on the reader's own
inference endpoint, a server they control. Then the text goes to that
server and to nowhere else. The reader sets the endpoint once, and opens
each private context to it in a dialog of the system that names the
host. A new host closes every context that was opened to the old one.

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
