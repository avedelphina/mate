# Document review

An example project. It is the only place in this context where someone works.

The desk is this folder. The document under review is a copy. The shelf
keeps serving the current text to every other project while this one is
unfinished.

## Files

- `intents.md` — which way to lean. Never completed.
- `principles.md` — rules of engagement. Not traded away to finish faster.
- `draft/` — the working copy and the comments on it.
- `dropbox/` — intake that belongs to this effort, not to the whole context.
- `panes/` — what an agent gathered to show you beside the draft: tasks,
  deadlines, mail. One file is one pane. A pane is not a source. You can
  tick a task in it, and press a line written as `[words](say:)` to say
  those words to the agent.

Comments are written into the markdown file with the same marker
[md-redline](https://github.com/dejuknow/md-redline) uses, so the comment
lives in git with the sentence it points at:

```markdown
The sentence being discussed.
<!-- @comment{"id":"1","anchor":"The sentence being discussed.","text":"Say why.","author":"you"} -->
```

Do not comment instruction files (`AGENTS.md` and the like). Those steer
the agent. They are not the document.
