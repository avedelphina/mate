# Security Policy

## Supported versions

Mate is pre-1.0. Only the latest release on `main` receives fixes.

| Version | Supported |
|---|---|
| 0.3.x | yes |
| 0.2.x and earlier | no |

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
  reader has not approved.

## What is not in scope

- The behaviour of the agents themselves (Claude Code, Codex, Hermes). Report
  those to their vendors. Mate's job is to limit what they are given and to
  check what they change, and reports about that are in scope.
- A context that you chose to trust. A context folder can contain hooks and
  scripts, and Mate does not run them, but opening a context you do not
  trust is a decision you make.
- What an agent does in a context you marked as trusted in Mate. There
  Hermes runs as it does in your own terminal, and Mate limits nothing
  outside the context folder.
- Issues that need a machine that is already compromised.

## Known limits, stated plainly

The guard that holds agents' changes works after a turn, not during it. A
change outside a project exists on disk until the turn ends. See the
[known limits in the README](README.md#known-limits).
