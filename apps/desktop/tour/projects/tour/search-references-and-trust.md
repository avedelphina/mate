# Search, references and trust

## Search

Press Command-K. The palette goes to a file or does a thing. The search box in the rail finds by
words, and by meaning when Ollama runs the `bge-m3` model on this computer. It reads PDF and Word
files as text. Press a `#tag` to find every document and comment that has it.

## References

Some things belong outside the context: the folder of another repository, a standard. **References**
in the rail points at one, with a line on when to look there. Nothing is copied. An agent looks only
when you ask about it, and never writes there. `[[name]]` names a reference when no document has that
name.

## Trust and privacy

A context runs no program unless you trust it, in a dialog of the system. Trust is needed for scripts,
for commits and for agents that have all their tools. It is kept outside the folder, so a folder you
download cannot give it to itself.

A context can be kept private. No agent works in it then, and nothing in it leaves this computer.

## Where to go next

- Read [[how-a-context-works]], on the shelf.
- Start a context of your own with **New context…**, or open a folder you already have.
- Delete this tour when you are done.
