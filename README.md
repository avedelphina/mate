# Mate

A desk for a body of work. The files are the application.

A **context** is a world of knowledge: a shelf of what is currently true,
and the projects inside it. You cannot act on a context.

A **project** is where work happens. It has its own folder, a draft, and
two short lists: intents, which steer, and principles, which you do not
trade away.

An agent can be invited into a project later. It may read the whole
context and it may not treat a draft as the reference. The desk is useful
before any agent is connected.

This repository is the shape of that desk. `apps/desktop` is a window
onto it: open a context, open a project, read the draft, write a comment
back into the file. See [docs/mvp.md](docs/mvp.md) for what that slice
includes and [docs/architecture.md](docs/architecture.md) for how the
window is built.

```
contexts/_example/
  shelf/            current reference, changed only by publishing
  dropbox/          intake for the world
  projects/
    document-review/    the desk: intents, principles, a working copy
    sibling/            another project in the same world, read from the first
```

See [docs/model.md](docs/model.md) for the rules and
[docs/roadmap.md](docs/roadmap.md) for the order it gets built in.

The example is empty on purpose. Copy `contexts/_example` and put your own
world in the copy. Do not commit private material to a public fork of this
repository.

## License

[MIT](LICENSE)
