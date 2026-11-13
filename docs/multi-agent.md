# More than one agent: a proposal

Proposed on 2026-11-13 as step 14 of [roadmap.md](roadmap.md), which
carries its summary. Nothing of this is built. Until the step is
accepted, the rules in `../AGENTS.md` hold as they are written.

## Why now

The field produced a reference point.
[Facade Code](https://github.com/y5ez3g/facadecode) is a VS Code
extension that runs coding agents — Claude Code, Codex, and others — and
lets them start, message, and operate one another. Looked at on
2026-11-13.

It proves the want is real: work that one agent hands to another. It
cannot give Mate its machinery. Facade drives agents through their
terminals: it reads screens, types keys, and tells a turn from a spinner
in a window title, pinned to a version of the CLI it drives. Mate speaks
to agents through ACP and their own output streams, and scrapes nothing.
What travels is the shape of the protocol, not the code.

The finding underneath is better: Mate already holds most of what more
than one agent needs. What is missing is small, and named below.

## What exists today

- **One writer per context.** A turn holds the context's busy flag, and a
  second session that would work is told to wait. The serialisation is
  the concurrency control, and it is already enforced (`busy` in
  `sessions.ts`).
- **A door that only reads.** The MCP endpoint has a reading mode: the
  project, its files, the search, and the comments, with no write tool
  (`READING` in `mcp.ts`). A reviewer exists in everything but the
  invitation.
- **Comments as the channel.** An agent reads review comments through the
  door, and with the full tool set writes its own. A comment is kept in
  the context and never touches the project until the reader shares it
  (rule 14), so two agents can speak in the margin with no lock on the
  draft.
- **Sessions are already plural.** Many sessions per project is normal.
  They share the project folder and not a transcript, and the window
  lists the context's sessions together.
- **Step 12 has the governed shape.** A listed reviewer, asked through an
  endpoint, answering in the margin, each request noted in the session.
  This step is its local form.

## The three things it can mean

**One writer, many readers that comment.** The invited agent writes; the
others read and answer in the margin. Safe by construction: readers hold
no lock and take none, and their words arrive as private comments.

**An agent asks another agent.** The invited agent needs a passage
checked, a table read, a language it does not have. It asks a listed
agent through the door and gets an answer, noted in its session. The
asked agent reads only.

**Writers in parallel.** Not taken. For a project that is a repository,
step 12's branches answer it: each agent on its own branch, the merge the
approval, the hold enforceable on the forge. For a plain project, the
write lock is the design, not the lack of one.

## The changes, in order

Each is usable on its own.

**The lock gates writing, not presence.** Today any turn takes the busy
flag, so a reading session cannot run beside the writer. The flag moves
from "a turn runs" to "a write runs." Two writers in one context still
meet the lock; a reader never takes it. How the reader talks to each
session does not change.

**The door gains a commenting mode.** Between reading and writing: the
reading tools plus `mate_comment` and `mate_reply`. A comment lands in
`.mate/` as every new comment does, private until the reader shares it,
so this mode still writes nothing to the project. This is the shape a
listed reviewer takes, here and in step 12.

**The door learns `mate_ask`.** The invited agent names a listed agent, a
question, and the files the answer needs. Mate starts the asked agent in
a reading session of the same project, sends the question and the named
files, and notes the exchange in the asking session: who was asked, what
they were given, what they answered — the note step 12 prescribes for
reviewers. Two rules come from Facade, worth keeping in their words:

- A start is idempotent: a retried request with the same request id never
  starts a second agent. Retries happen on every transport; the rule
  costs one line.
- When the asked agent waits on the reader — a sign-in, a refusal — the
  asker is told, and the reader gets the system's notice, as today.

**The list is the reader's.** Which agents may be asked is set by hand,
per context, in Settings — as agents on other machines are added today,
because asking sends text there. A private context asks nobody, unless
the reader opened it to that agent, as in step 12.

## Rules this changes

One clause of rule 13. Today a document's text leaves the computer only
when the reader sends it: to their own endpoint, to an invited agent, or
to their forge in a review. This step adds: and to an agent the reader
listed as askable in that context, in the amount the asking agent names.
The list stands in for the invitation; the note in the session says what
was sent.

No other rule moves. The asked agent writes nothing, so `judge` and the
hold are untouched (rule 5). Sessions end with the app as today; an agent
that must outlive the laptop is the Hub's (rule 11, step 11). Only the
reader publishes and commits (rule 10).

## What this step is not

- A mesh where any agent reaches any other. Facade opens that reach with
  one flag; Mate's unit of reach is the list, per context, set by hand.
- An agent started without the list, or with write tools.
- Driving an agent through its terminal. A CLI with no ACP and no
  readable stream is not invited; Mate does not learn to scrape.
