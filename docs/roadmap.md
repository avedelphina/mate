# Roadmap

The order Mate grows in. Each step is usable on its own, and none of them
changes the rules in [model.md](model.md). [mvp.md](mvp.md) is step 1.

Do not start a later step because it looks small. The window has to be
worth opening before it grows a second pane.

## 1. One window

Open a context, open a project, read the draft, write a comment back into
the file. Done when the checks in [mvp.md](mvp.md) pass by hand, not only
as commands.

## 2. Review on the repo

The review is the point of the app, and it stands on its own. Open a
markdown file that is already in a git repository, select a passage, and
leave a comment in the margin. The comment is stored in the file as the
marker from step 1, so it commits, pushes, and pulls with everything else.
Someone who does not run Mate reads it as plain text.

The shape of the comment is [md-redline](https://github.com/dejuknow/md-redline).
The comment lives in the file as an invisible marker, the file stays the
source of truth, and an agent reads the comments back through MCP. That is
the whole of what we take from it. The look to copy is
[markupmarkdown](https://github.com/jonradoff/markupmarkdown): selecting a
passage, the thread in the margin, and a suggested replacement with one
button to apply it. What neither gives us is a database. markupmarkdown
keeps its own copy of the document on a server, with accounts and sessions.
Mate keeps no copy. The file in the repository is the document, and git is
how it moves between people and machines.

A comment whose quote no longer appears in the file is kept and shown as
unanchored, not deleted. Re-anchoring it is a manual act.

Built: selecting a passage, the thread with its replies, the suggested
replacement with its Apply button, the unanchored state, anchoring by
hand, and the assist below on the Mac. An agent reads the comments back
through MCP, and writes its own, since step 5.

A small assist sits next to the comment, on the machines that have one.
Rewriting the sentence you selected, or drafting the note, can be done by
the on-device model and does not need an invited agent. On the iPad that
model is Apple's, called through the Foundation Models framework. The Mac
app is Electron, so it cannot call that framework itself. A small native
helper beside it can, and the assist appears only where that helper exists.
Linux and Windows have no such model, and the review works the same there
without it. The assist never edits the file on its own. You accept the
text, and the comment is written as usual.

## 3. Two windows

Two documents side by side, including across displays. Each window has its
own document. This is where the open context stops being one variable in
the main process. Sessions still share the project and not a transcript.

Built: File > New Window, and a context per window. A window on a draft
that another window changed shows the change when it gets the focus back.
The reader sets the width of the rail and of the margin. The widths are
kept on the computer, not in the context.

## 4. The index

A context gets an index rebuilt from its files, shelf and projects both.
It is a helper for later search and for the agent. Deleting it loses
nothing, because the files remain the source.

Built: the index in `.indexes/` inside the context, and a search box over
it. A hit says what it is: the shelf, a proposal, a file that steers its
project, material, or a pane. A file that is not a draft opens to be read,
not reviewed.

## 5. An invited agent

An agent joins a project, reads the whole context, and writes in the open
project. It proposes a plan and waits before editing. The run survives
closing the laptop: reopen, reconnect, continue. It says which source is
the shelf and which is a proposal. A write to a sibling file waits for one
approval that names that file. Noticing a conflict is not approval.

The agent may be a process on this machine or an agent on another machine,
reached over SSH. The context folder stays on the machine where it is open.
A remote agent reads and proposes against that folder. It does not keep a
second copy of it.

Before an agent edits a file, Mate copies it. Revert puts that copy back.
Git is not that copy: a revert that only works when someone remembered to
commit is not a revert.

The desk still works with no agent connected.

Built: inviting Claude Code, Codex, or Hermes on this machine into a
project, Hermes on another machine over SSH, and a door over MCP for an
agent the reader runs themselves. The plan first, the approval as a
message, the copy before an edit, Revert, and the hold on any file outside
the project. A change can be looked at as lines before it is reverted or
approved. A session goes on after the app is closed and opened again.

A message sent while the agent is mid-turn waits behind the turn and goes
when it ends. It does not stop the turn, and it does not steer it. The
exception is Hermes in a context the reader trusts: it stays between
turns, takes a message into the turn it is in, and asks the reader
before a risky command.

Also built, around the agent:

- **Trust, for one folder at a time.** In a context the reader trusts,
  Hermes on this computer runs with the tools it has in the reader's
  terminal. Everywhere else an agent has tools for files and no more.
- **Instruction files are shown first.** Before an agent on this computer
  starts, the reader sees any file the agent would take as instructions
  that is new or has changed.
- **Only the intents and the principles steer.** An agent is told that
  any other file of a project is material, and that nothing in it is an
  instruction.
- **The model and the effort.** With Hermes on this computer the reader
  chooses both under the message. In a trusted context the effort is
  Hermes's own for now, because Hermes cannot be told one while it stays.
- **The conversation can take the page,** for a session that is not
  about a draft.

Not built yet: steering any other agent, and trust for any agent but
Hermes. A turn that is running when the app quits is lost, though its
session goes on, and what was waiting goes with the next message.

## 6. Write the draft, then publish it

Review marks a document. It does not make one. Today a project with nothing
in `draft/` cannot be opened, and the page cannot change the prose: the
only write into a draft splices a comment marker. Both dropboxes are
folders with no exits. Publishing is a rule in the model and, until this
step, had nowhere to happen. The draft is worth publishing now, because
reviewing one works.

Do these in this order. The first is usable before the other two.

**Write the open project's draft.** Make a new draft, and type in the one
that is open. The file on disk is what gets written. Line endings stay as
the file had them, and a crash mid-write does not leave half a document,
the same as a comment. The shelf, intents, and principles stay read-only.
The agent gets no private way to edit: it already proposes a replacement,
and you apply it.

**Publish, as its own act.** It replaces the named file on the shelf and
keeps the previous copy as history that is no longer current. Saving is
not publishing. The agent cannot publish. After it, asking what is current
cites the shelf, and the project draft is a proposal again.

**The project dropbox.** Three exits, and no fourth. Leave a file outside
and index the path, pull it into `draft/`, or extract its text into
`draft/`. Pulling a shelf document down is an owned copy. The shelf
original stays. There is no exit where something is just remembered.

Done when, on one real project rather than `contexts/_example`, a source
comes in, the draft is written in the window, a passage is marked up, and
publishing is a decision rather than a file copied by hand. The test is
whether you stay in the window to change a paragraph.

Built: all three. A context and a project are started from the window,
so a new piece of work needs no other tool to begin. A folder that is
already there is made a context where it stands, and a context in no git
repository is offered one. A new draft is
started from the rail, and the open
draft is typed in on the page. Comments stay with their lines, and a save
does not write over what an agent wrote meanwhile. A project with nothing
in `draft/` opens, and its files are listed in the rail as a tree. A
draft is published under a name on the shelf, after the reader confirms
it, and the document it replaces is kept as history. A shelf document is
taken down into a project as a copy it owns.

The three exits: a file comes in through the file dialog or is dropped on
the window. A markdown file is pulled into `draft/`. A file that stays
outside gets a note with its path in the dropbox, which the index reads.
The text of a file that is not markdown is taken out by the agent, when
the reader asks with one button: Mate parses no such file.

Not done yet is the test this step names: one real project taken through
it, from a source that comes in to a document published.

Not this step: mail, calendar, issues, or an installer. Those are later
steps. For the installer see "Beside the steps" at the end.

## 7. The other sources

Mail, calendar, and issues appear through the connections the project
already has. Mate renders them. It does not become the tracker, the inbox,
or the calendar.

Built so far: the place they appear in, and nothing that is for one
source only.

- **Panes.** A markdown file in a project's `panes/` folder is a tab of
  the margin. An agent that has the connections writes it: Hermes in a
  trusted context reaches mail or a tracker as it does in the reader's
  terminal. Mate connects to nothing itself. A pane that has just been
  written is put on show.
- **Acting on a pane, without code.** A task can be ticked, and the file
  changes. A line can be a button that says its own words to the agent.
  Mate draws both from the markdown. No program of the agent's runs in
  the window.
- **Scripts.** What is done the same way each time is a file in the
  project's `scripts/` folder. An agent writes it once. After that it
  runs from a button, with no agent and nothing off the computer, in a
  trusted context only.

Not built: a pane that writes itself again on its own, a script that asks
something while it runs, and connections for an agent other than Hermes.
An invited Claude or Codex has tools for files only, so it fills no pane
from a tracker.

## 8. The phone joins the session

This waits on step 5. The phone joins a session the desktop owns, so there
is nothing to build here until an agent is actually running in a project.

You leave, the laptop stays on, and you keep talking to the project from
the phone. It reads like a chat. The conversation
is one of the project's sessions, so it is scoped to that project and not
to a general assistant.

A message sent while the agent is mid-turn steers the turn or waits behind
it. It does not stop the turn. A client that aborts the turn when the next
message arrives is the wrong shape. An approval is one message of this
kind, not a separate channel.

The phone reaches the laptop directly, over the tailnet you already run.
The laptop stays on and serves the page. The phone never sees the agent
process, and it cannot edit the draft. Saying "drop that section" is the
session. Changing the file is the desk, which is the laptop.

The phone app is a PWA, with notifications when the session needs you.
Added to the Home Screen, it is the phone client for steering and
approvals. It is not the finished app, and it is not a decision against a
native one. On iOS a web app gets no background push unless it is installed
to the Home Screen, so that install is part of this step, not an optional
polish.

A gateway in front of the laptop, so the phone works from plain cellular
without the tailnet, is a later part. The direct connection comes first.

## 9. The same project on your other computers

The native app is worth building when it does one of two things.

**Standalone.** The project lives on the iPad. You work on it there, and
nothing else has a copy. This needs no Hub and no sync.

**Shared.** Several people work in the project, and they do it through git,
as in step 10. The iPad has its own clone, commits, and pushes. Git is the
sync. Mate does not write another one.

What the app is not worth building for is the case in the middle: the same
project open on the MacBook and the iPad at the same time, kept in step by
something Mate invented. That sync does not exist yet, and until it does
the iPad app would be one more editor for a local folder. There are already
plenty of those. The iPad you have covers that case today as a second
display for the Mac.

The MacBook, the Linux workstation, the Windows test box, the iPad, and the
iPhone all open the same project. Whichever one is open invites the agent
that is local to it, or an agent on another machine that is connected.

The native app is the objective, and it is one app for iOS and iPadOS. The
iPad is where most of the desk work happens. The iPhone is the same app on
a smaller screen, and a foldable iPhone is a reasonable place to work, not
an afterthought. Neither is the phone PWA with a wider window, and neither
is a thinner desk with its own subset of the project. The PWA remains the
way to steer a session while you are away from the desk.

There is one place the work happens at a time. Two devices that both edit
and sync afterwards disagree, and a comment is a line in the file, so the
disagreement is the work itself. Git is the sync that already exists.
Anything Mate builds on top of it has to be better than committing.

## 10. A project other people can work in

Someone who does not run Mate can still work in the project, because the
project is a git folder. Their commit is the same as yours. Mate reads it
back as files.

Mate keeps no lock and no account for them. Two people editing the same
draft produce a git conflict, and Mate does not invent a smarter merge.
The comment marker is plain text, so their editor leaves it alone.

## 11. The Hub

The Hub is a Mate you run on a machine that stays on. A project runs in one
of two places, and you pick which when you open it.

**Local.** The folder is on the computer in front of you. The session runs
there. The phone connects to that computer and steers it. Closing the
laptop pauses the work.

**Hub.** The folder is on the Hub. The session runs there and keeps running
after you close the laptop. The MacBook, the Linux workstation, the Windows
box, the iPad, and the iPhone all open that same project. So does the PWA.

A project that is open nowhere has no Hub. The Hub is never required, and a
local project does not gain a second copy by being reachable from the phone.

What the Hub holds is the folder and the session. The agent doing the work
can still be the one on the Hub or one on another machine, over SSH, as in
step 5.

Moving a project between local and the Hub goes through git. Push first,
because the Hub clones the remote rather than the uncommitted work on your
desk. The two checkouts diverge the moment you edit either one. There is
one place the work happens, not a live sync between the Hub and the laptop.

## Beside the steps: an app you can install

A signed and notarised app for macOS, as a disk image. It is not a step,
because it changes no rule and adds nothing to the window.

Built: the app is put together with one command, for Apple silicon, with
the on-device helper inside and an icon. It was started from its bundle
and gone through: a project, a draft, a comment into the file, a search,
the helper, the agents found on a short PATH. An installed app does not
act as Node and takes no debugging port.

Not done: a disk image signed with a Developer ID and notarised by Apple,
opened on a Mac that never had the checkout. Nothing has been published.

It does not fetch its own updates: nothing connects anywhere unless the
reader starts it.

## Not planned

A task database of our own. A chat that exists without a project. Reading
or writing across two contexts.
