# Security Policy

## Supported versions

Mate is pre-1.0. Only the latest release on `main` receives fixes.

| Version | Supported |
|---|---|
| 0.4.x | yes |
| 0.3.x and earlier | no |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private vulnerability reporting for this repository:
**Security → Report a vulnerability** on
<https://github.com/avedelphina/mate>. That keeps the report private until
a fix is ready.

Include, if you can:

- the version or commit you tested;
- the operating system and the agent involved, if any;
- the smallest steps that show the problem, ideally with a sample context;
- what you expected, and what happened.

You can expect an acknowledgement within a week. Mate is maintained by
volunteers, so fixes may take longer for complex issues. Coordinated
disclosure is welcome: we will agree on a date with you before anything is
published.

## What is in scope

Mate's security model is in [docs/model.md](docs/model.md) and
[docs/architecture.md](docs/architecture.md). Reports are most useful when
they show that the model is broken, for example:

- a way for a context, a draft, or an agent's output to run code, reach a
  file outside the context, or write without the reader's approval;
- a way for a web page, another local user, or another process to use the
  local MCP endpoint without its token;
- a way to make the renderer reach the file system or Node APIs despite the
  sandbox;
- a way to pass an unchecked value to `ssh` or to a shell;
- a way for a context to become trusted without the reader's answer in the
  system dialog;
- a way for an agent on this computer to start with instruction files the
  reader has not approved;
- a way to run a script in a context the reader has not trusted, or to
  run a file that is not in the `scripts/` folder of the open project;
- a way for text in a pane, a draft or any other file to run as a
  program in the window, or to make a button say to an agent anything but
  the words it shows;
- a way to publish to the shelf without the reader's answer in the system
  dialog, or for an agent to publish;
- a way for the window to make the main process read or copy a file
  outside the context that the reader did not choose in the system's file
  dialog;
- a way for a value kept in a session file, such as the name of a model,
  to reach an agent's command line as an option;
- a way to make the installed app act as Node, load code that was not
  packed with it, or be driven through a debugging port;
- a way to make Mate run git in a repository of a context the reader has
  not trusted, or make a commit the reader did not ask for, or reach a
  remote.

## What is not in scope

- The behaviour of the agents themselves (Claude Code, Codex, Hermes). Report
  those to their vendors. Mate's job is to limit what they are given and to
  check what they change, and reports about that are in scope.
- A context from a source you do not know, that you chose to open. A
  context folder can contain hooks and scripts. Mate runs none of them
  unless you marked the context as trusted and pressed a script's button,
  but opening such a folder, and asking an agent to work in it, is a
  decision you make.
- What a script does once you run it in a context you marked as trusted.
  It is a program with your rights. The same holds for the hooks of a
  repository when you commit there.
- What an agent does in a context you marked as trusted in Mate. There
  Hermes runs as it does in your own terminal, and Mate limits nothing
  outside the context folder.
- Issues that need a machine that is already compromised.

## Known limits, stated plainly

The guard that holds agents' changes works after a turn, not during it. A
change outside a project exists on disk until the turn ends. See the
[known limits in the README](README.md#known-limits).
