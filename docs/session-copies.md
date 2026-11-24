# Sessions on their own copy: a proposal

Proposed on 2026-11-24 as the second form of "writers in parallel" in
step 14 of [roadmap.md](roadmap.md) (see [multi-agent.md](multi-agent.md)).
Nothing of this is built. Until it is accepted, the rules in
`../AGENTS.md` hold as they are written.

## Why

Claude and other tools let you open many sessions and work with them at
once. They can do it because each session works on its own copy of the
project, a git worktree on its own branch. The sessions cannot step on each
other, and you merge the results when you are ready.

Mate has no copies. Every session works in the real folder. So it has one
writer for each project, or, since 0.39.0, one for each project or folder
when the reader allows it. That works, and it gives up one thing. While two
agents work, Mate cannot tell which of them wrote a file in a project.

A copy gives that back. If an agent can only write in its own copy, then
everything in the copy is its work, and nothing else is.

## What it is

A session may work on a copy of its project. The copy is outside the
context. The agent works there. When the turn ends, Mate takes what changed
in the copy and puts it into the real project, file by file, through the
rules it has now. A file that someone else changed in the meantime is not
overwritten. It is held for the reader.

Many sessions can then work in one project, on the same files, at the same
time. They meet only when their results are put back.

## The first form is for repositories

A project that is a git repository is the first case, for three reasons.

- Mate can leave out what git ignores: `node_modules`, build output, the
  files nobody wants a copy of. A repository is often much bigger than the
  work in it.
- The copy has no `.git`. Hooks and config cannot be reached from the copy,
  so an agent cannot write one. Today the guard has to watch for that.
- After the results are put back, the reader commits as always. Mate adds no
  commit, no branch and no remote (rule 10).

A project that is not a repository can use the same copy, in a later
step. The difference is only how the list of files is made.

## How a turn goes

1. **Make or bring up to date the copy.** The first turn of a session makes
   it. A later turn updates it: a file that changed in the project since the
   last turn is copied again. Which files changed is told by size and time
   stamp, as the guard does since 0.39.0, so it is quick.
2. **The agent works in the copy.** Its working folder is the copy. Nothing
   it writes there touches the real project.
3. **Mate looks at the copy.** What differs from how the turn began is the
   agent's work. Nothing else needs a guess.
4. **Put back.** Before the plan is approved nothing is put back, and the
   reader sees what the agent would have changed. After it, each changed
   file goes through `judge`, as now.
5. **Conflicts.** For each changed file, Mate compares the project now with
   the project as the turn began.
   - Same: the agent's file is written, with the old bytes kept so Revert
     works. This is "kept" today.
   - Different: someone changed it too, the reader or another session. The
     agent's file is not written. It is held, with the file as it is, as
     any held change is. The reader chooses.
6. **The copy stays** for the next turn. It goes when the session is deleted.

## Where the copy is, and what the agent sees

The copy is in a folder of Mate's own, outside every context, such as
`<settings folder>/copies/<context>/<session>/`. It is local, so a context
on a network share is not slowed by it, and the context is not filled with
it. It is a helper: deleting it loses nothing, because the work was put back
into the project at the end of each turn.

The agent's working folder must stay the same from one turn to the next.
Claude Code finds its conversation again by the folder it is in, and Hermes
stays alive in one. So the copy has a fixed path for the life of the session.

The rules Mate gives an agent say `../../shelf/`, `../../.mate/…` and
`../` for the other projects. The copy is laid out so that these still hold:

```
copies/<context>/<session>/
  projects/<project>/        the copy of the project: where the agent works
  projects/<other>  ->       links to the other projects of the context
  shelf, templates, .indexes, .mate, intents.md, principles.md  ->  links
```

The agent reads the whole context, as now. It writes in the copy. A write
through one of the links goes to the real context and is dealt with as an
edit outside the project is today: held, and put back.

The copy is limited in size. A project over the limit, or on a folder the
system keeps only in the cloud, is not copied, and works in place as now.
Reading a cloud placeholder fetches it, and a copy would fetch all of them.

## Repositories: how the files are chosen

For a repository, Mate asks git which files are the project's:

```
git ls-files -z --cached --others --exclude-standard
```

That lists tracked files and new files, and leaves out ignored ones. It
reads the index and does not run hooks. Git can still be told by a
repository's own config to start a program, so Mate turns that off for this
command (`core.hooksPath`, `core.fsmonitor`) and runs it only in a context
the reader trusts, as it does every git command except `git init`
(rule 7). In a context that is not trusted, a repository is copied whole,
without `.git`, and without asking git anything.

Mate copies the files as they are in the working folder, not as they are in
the last commit. What the reader changed and has not committed is in the
copy. Mate does not use `git worktree`. A worktree starts from a commit, runs
checkout filters and hooks, and so does not match the folder the reader sees.

## What the reader sees

- A session says it works on a copy.
- While the turn runs, the session lists the files that differ in the copy,
  so the reader can see the work as it goes. The project does not change
  until the turn ends.
- At the end, the usual lines: what was kept, with Diff and Revert, and what
  is held. A conflict says so, and shows the project's file, the agent's
  file, and the file as the turn began.
- Revert and the held-file approval work as now.

Later, a text file that both sides changed in different places may be merged
(`git merge-file` on the three versions), and held only when the changes
overlap. The first form holds every conflict.

## What the guard does

The guard looks at the real context during the turn, as now. Under a copy it
has less to explain.

- Changes Mate itself puts back into the project are told to the guard, as
  Mate's own writes are.
- A change in the real context that Mate did not make is not the agent's
  work, since the agent works in the copy. One outside the project is put
  back and held, as now. It means the agent wrote through a link or an
  absolute path.
- A change in the real project folder is left alone. It is the reader
  editing, or another session being put back, and neither is to be undone.

Two ceilings. The dialog that turns copies on must say both.

- An agent that can write anywhere on the computer, such as Hermes or Kimi
  in a trusted context, can still write into the real project by its
  absolute path. Mate sees a change in the project that it did not make, and
  leaves it alone, because it cannot tell that agent from the reader. Today
  the guard holds such a change when it is made before the plan is
  approved. So for those agents a copy is weaker than working in place. For
  Claude Code and Codex, which stay inside their working folder, it is a real
  wall.
- Writes through the links to `.mate/` for the project's own panes and
  comments reach the real context at once, and are kept at the end of the
  turn, as now.

## Rules

None changes. They are checked here because the proposal touches them.

- **1, the file is the truth.** The copy is a helper outside the context and
  can be deleted.
- **5, the agent does not decide.** Every change reaches the project through
  `judge`. A change that cannot be put back safely is held.
- **7, no program unless trusted.** A git command runs only in a trusted
  context, with hooks and `fsmonitor` turned off. A copy of a repository
  has no `.git`.
- **10, only the reader commits.** Mate puts files into the working folder.
  It never commits.
- **11, an agent does not outlive the app.** As now.
- **13, a document goes nowhere else.** A copy is on this computer.

## The order of building

Each step is usable alone.

1. **The copy and the put-back, for a repository in a trusted context.**
   One session, one copy. File-level conflicts held. This alone gives the
   reader sessions that run beside each other in one project.
2. **Many sessions on copies in one project**, and the setting that allows
   them. The 0.39.0 setting stays for sessions that work in place.
3. **A project that is not a repository, and a repository that is not
   trusted.** The list of files is made by Mate, with a size limit.
4. **Merging text.** Changes in different places of one file are merged.
5. **Show the work in the copy as it goes**, with the files and their lines.

## What this is not

- A branch, a commit or a pull request made by Mate. The reader commits.
- A copy of a project kept only in the cloud.
- A way for two agents to write the same file without the reader seeing it.
  Their results meet at the put-back, and a clash is the reader's.

## For the owner to decide

1. **Put back at the end of the turn, or wait for the reader?** The proposal
   does what Mate does now: after the plan is approved, a turn's changes
   go into the project and can be reverted. The other way is that nothing
   goes until the reader presses Apply. It is safer and slower.
2. **Is the ceiling for Hermes acceptable?** Only Claude Code and Codex get
   the wall. For Hermes and Kimi a copy is weaker than working in place:
   a write by absolute path into the project is no longer held before
   approval. The alternative is that a session of those agents never uses a
   copy.
3. **The size limit.** A copy of a very large project is slow on a disk
   without clones. The proposal refuses over a limit and works in place. What
   limit?
