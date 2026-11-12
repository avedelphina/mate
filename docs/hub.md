# The Hub: a proposal

Accepted on 2026-11-12 as step 11 of [roadmap.md](roadmap.md), which it
summarises. Step 12 keeps how an agent outside Mate proposes and how anyone
reviews. Nothing of this is built. Until it is, the rules in `AGENTS.md`
hold as they are written.

## What changed

Step 11 was written when Mate kept its files in the project: comments in
the draft, panes in `panes/`, notes beside the file. A project was the whole
of the work, so the Hub held projects, and a project moved to the Hub
through git.

Since 0.33.0 that is not so. Mate keeps its own files in the context:
`.mate/` holds the private comments, the panes and the notes, `.sessions/`
the conversations. The shelf, the dropbox and the context's intents and
principles were there already. A project holds only what the reader
brought. So there are two kinds of folder:

| | A project | A context |
|---|---|---|
| What it is | The reader's folder or repository | The reader's desk around it |
| Who else sees it | Whoever has the repository | Nobody |
| How it moves | git, for a repository | The Hub |

Moving a project through git moves the wrong thing: the private layer stays
behind. And the reader expects three things the old step did not give:

- **Work offline**, on a laptop and on a phone or a tablet.
- **The same context on every device**, the MacBook, the iPad and the
  iPhone, without setting up a sync of their own.
- **A Hub they can run** on a Mac, for everything, or in Docker, for less.

## The shape

**The Hub holds the reader's contexts and keeps every device in step with
them.** It is a Mate with no window, on a machine that stays on.

- **Every device keeps its own copy** of the contexts it holds, and works
  on it offline. When the Hub can be reached again, the device and the Hub
  exchange what changed.
- **Git syncs what git owns, and the Hub syncs the rest.** A repository
  goes between the reader's machines through git, as today. Everything
  else of a context goes through the Hub: the private layer, the shelf, the
  dropbox, the steering files, and the projects that are plain folders.
- **What needs a machine that stays on runs on the Hub**: an agent that
  goes on when the laptop closes, the index and the vectors, the text of
  PDF and Word files, and a notice to a device.
- **The Hub is never required.** A context that is not on a Hub is what a
  context is today: a folder on one computer.

Devices sync only with the Hub, never with each other. One centre makes
every exchange a question of two copies, the device's and the Hub's.

## Two kinds of Hub

| | On a Mac | In Docker |
|---|---|---|
| Sync, agents, the index, search by words | Yes | Yes |
| Search by meaning | Ollama on the Mac | Ollama in a container beside it |
| Reached over | The overlay or the reader's proxy | The same |
| Text of PDF and Word files, scans read | PDFKit, Vision, `textutil` | No |
| Scripts of a project | macOS | Linux |
| Agents | Hermes and the others, on macOS | Those that run on Linux |

A Docker Hub leaves the text of PDF and Word files to a Mac. A Mac laptop
that holds the context makes the text and sends it to the Hub, as part of
what the context holds (see *What is exchanged*). With no Mac at all, those
files are found by their names only.

## How a device reaches the Hub

**Over a network the reader already runs, and never the public internet.**
The Hub is reached on a tailnet or another overlay network, or through a
reverse proxy the reader runs themselves. Mate offers no relay and no public
address, and the Hub listens on no public interface unless the reader's own
proxy puts it there. Reaching the Hub from plain cellular without the
overlay is not something Mate does.

**HTTPS, on one port.** The exchange and the live events, such as an
agent's steps and a file that changed, go over a WebSocket on that port.
The Mac, the iPad, the iPhone and later the PWA all use the same endpoint,
so there is no second service for the phone.

**Each Mate has a key, and its identity is the key's fingerprint.** This
is Syncthing's convention: a device ID is the fingerprint of its
certificate, and the two sides speak TLS pinned to each other's. No
certificate authority, no account, and no password. The Hub keeps the
list of its devices.

**Pairing** borrows two ideas, and says so. Neither is a standard Mate
could follow as it is written.

- **The first device scans a QR**, as a contact joins in Delta Chat's
  SecureJoin. `mate-hub pair` prints it in the terminal, inside the
  container too with `docker exec -it`. It holds the Hub's address, the
  fingerprint of its key, and a secret that works once and soon expires.
  The device reaches the address, checks that the key it meets is the one
  in the QR, and sends the secret with its own key. A man in the middle
  cannot pass: the camera is the channel he does not have. A device with
  no camera types the address and a code, and is shown the Hub's
  fingerprint to compare.
- **Every later device is approved from one already paired**, as Jellyfin's
  Quick Connect lets a signed-in client approve a new one. The new device
  shows a short code. The reader's Mac asks in a dialog of the system,
  "Let iPad join the Hub?", with the code to compare. Approving a device is
  the reader's alone to decide (rule 9). The new device learns the Hub's
  fingerprint from that approval.

**Revoking a device** is done on any paired device, or with
`mate-hub devices remove`. Its key no longer opens anything.

**The PWA** is the one client that cannot pin a key, because a browser
does not let a page do that. It needs a certificate the browser trusts:
`tailscale serve` gives the Hub one for its name on the tailnet, and the
reader's proxy gives one otherwise. It comes last.

**SSH stays where it is**: Mate reaching an agent on another machine
(step 5). It is not how a device reaches the Hub.

## What is exchanged

The unit is a file. Each side remembers, for every file, the version the
two last agreed on: its base. A file changed on one side only goes to the
other. A file changed on both sides is merged (next section).

Exchanged:

- the projects that are plain folders, every file;
- `.mate/`: the private comments, the panes, the notes;
- `.sessions/`;
- the shelf, the dropbox, `templates/`, `intents.md`, `principles.md`;
- `.indexes/text/`, the text of PDF and Word files. It can be made again,
  but only on a Mac, so it travels as a cache.

Not exchanged:

- a project that is a repository (see *Repositories*);
- `.indexes/context.json` and `meaning.json`, which each machine makes from
  the files;
- anything under `.git`, and `node_modules`.

**When.** While Mate is open on a device and the Hub can be reached: when
a context opens, after a change, and when the network comes back. Nothing
runs while Mate is closed on that device.

## When two devices changed the same file

Files are the truth, so a merge never hides a version. What cannot be
merged is kept, and the reader picks.

- **Markdown and other text** is merged by lines, from the base, as
  `git merge-file` does. When the two changed different lines, the result
  is both. When they changed the same lines, the Hub's version stays where
  it is, and the device's is kept beside it as
  `NAME (from iPad, 2026-11-12).md`. Mate shows the two side by side, and
  the reader keeps one, or a mix, and deletes the other.
- **A file of comments** is merged comment by comment and reply by reply,
  since each has an id. Two new comments are both kept. A comment whose
  words both sides changed keeps the later words, and the earlier ones
  become a reply, so nothing is lost. This needs ids that two devices
  cannot both make. Today a new comment takes the next number in its file,
  so two devices offline would both write `3`.
- **A pane** is the agent's. If the agent wrote it again while a device
  ticked a task offline, the tick is made again on the new text when its
  line is still there, and said lost when it is not.
- **A session** has one writer: the machine its agent ran on. Others only
  read it.
- **A change and a deletion**: the change wins, and the file comes back.
  The reader is told.
- **Anything else**, such as a PDF in the dropbox, is kept twice, like a
  text that could not be merged.

## Repositories

A project that is a repository is synced as a repository.

- **Each machine that holds it has its own clone.** The Hub has one too,
  and is the private place where the reader's machines meet. The forge
  stays the place where the project is shared, and a push there is the
  reader's act, as it is now.
- **Nothing is committed on its own.** *Send* commits the reader's change
  and pushes it to the Hub. *Fetch* brings in what the reader's other
  machines sent. Both are buttons. A change not yet sent stays on the
  device, as in any clone.
- **Git on a phone or a tablet is a library**, so no hook or filter of the
  repository runs there.
- **An agent on the Hub works on its own branch**, `mate/<session>`. The
  device fetches it, shows the change as lines, and the reader merges it or
  drops it. The merge is the approval. An agent's key may push `mate/*` and
  nothing else, so the hold does not depend on the agent behaving.
- **The private comments on a repository's files go through the Hub**, not
  through git. They are anchored by the words they quote, so a comment that
  arrives before the text it is about waits, unanchored, until the text is
  fetched.

## Working offline

On a laptop and on a phone or a tablet, everything that is a file works:
reading, typing, comments and replies, notes, ticking a task, publishing
to the shelf, *Send to project*. It all goes to the Hub when it can.

What needs the Hub or the network:

- **An agent**, unless the laptop runs one of its own. A message to an
  agent on the Hub is sent when the Hub can be reached, not before.
- **Search by meaning**, unless the laptop has Ollama. Search by words
  works everywhere.
- **The text of a new PDF or Word file**, on a device that is not a Mac.
- **Sending to a repository's remote**, and the review of a pull request.

## What each machine keeps for itself

Kept outside the folder, as today, and never exchanged as files:

- **Trust**, for each machine. It says what may run there, and a machine
  is trusted for that by the reader on that machine.
- **The approved instruction files**, for each machine an agent runs on.
- **Keys**: a forge's token, the endpoint's key, the Firecrawl key. Each is
  kept on the machine that makes the request, sealed, and no agent is given
  one.

**Privacy is the reader's one answer.** A context kept private on one
device is private on all of them. The Hub carries that answer to each
device over the same connection, not in the folder, so nothing in a context
can turn it off.

## Rules this changes

These were listed under step 12 before.

- **Rule 6.** The Hub the reader paired counts as started by them. The
  exchange with it runs when the Hub can be reached, without a press each
  time, and with that Hub only, over the reader's overlay or proxy.
- **Rule 9.** In a native app on a device, the app's own dialog is a dialog
  of the system: no content of a context can press it. Pairing a device is
  one of the decisions asked there. A PWA does not publish, trust, pair a
  device, or approve instruction files.
- **Rule 10.** Only the reader commits, and nothing is committed on its
  own. *Send* and *Fetch* push to and pull from the Hub on the reader's
  press. Mate adds the Hub as a repository's remote only when the reader
  puts that project on the Hub.
- **Rule 11.** An agent lives with the Mate that started it. On the Hub,
  that Mate stays on.
- **Rule 13.** A document's text may go to the reader's own Hub and to
  their own devices, and from the Hub to an agent or an endpoint the reader
  allowed, as today.

- **CONTRIBUTING.** "A change that adds a server, accounts, or a second
  copy of a document will not be merged" gets an exception: the Hub, which
  the reader runs on their own machine. It holds their contexts, so it is a
  server and a second copy, and it says so. It has no accounts, and it is
  never reached from the public internet by anything of Mate's.

Rules 1, 2, 3, 4, 5, 7, 8, 12 and 14 hold as they are. A kept version is a
file, so rule 1 holds through a conflict. Private comments go to the
reader's own Hub, never into a repository, so rule 14 holds.

## The order of the work

Each step is usable on its own.

1. **Two Macs and a Hub on a Mac**, for a context of plain folders:
   pairing by QR and by approval, the pinned connection, the exchange, the
   base of each file, the merge by lines, the kept version and the window
   that resolves it.
2. **Comments that merge**: ids two devices cannot both make, and the merge
   by comment and reply.
3. **Repositories**: the Hub's clone, *Send* and *Fetch*, and an agent's
   branch.
4. **Agents on the Hub**: a turn that goes on when the laptop closes, a
   notice to a device, a message sent when the Hub is back.
5. **The Docker Hub**: an image, Ollama beside it, `mate-hub pair` in the
   container, the text of PDF and Word files from a Mac.
6. **The iPad and iPhone app** (step 9), on the same exchange.
7. **The PWA** (step 8): steer a session and approve a plan, on the same
   endpoint, with a certificate the browser trusts.

## Not in this

- **A context shared with another person.** A context is one reader's
  desk. People share projects, through git.
- **Typing together in one file at the same moment.** Changes meet when
  they are exchanged, a file at a time.
- **Devices that sync with each other** without the Hub.
- **The public internet.** No relay, no address of Mate's, no way in that
  the reader did not build with their overlay or their proxy.

## Open questions

1. **The form of a comment's id.** md-redline reads `id` as a string. Check
   what it writes itself before choosing one that two devices cannot both
   make, so that a file stays readable by both tools.
2. **How much a phone keeps.** A whole context, or only the projects the
   reader picks on that device.
3. **Merging a draft's shared comments.** They are lines in the file, so
   the merge by lines takes them. Two devices that both changed one
   comment's marker give a kept version, not a merge by comment. That is
   probably good enough.
