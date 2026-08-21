# Context / knowledge base

Two files, two owners — don't conflate them:

- `knowledge-base.md` — human-curated. Domain facts, conventions, access
  notes you write and maintain by hand. The BA agent reads it on every
  `draft` run; it never writes to it.
- `context-lake.md` — agent-written. Populated automatically after every
  `approve`, from durable knowledge extracted out of the approved
  requirements doc (see `skills/update-context-lake.md`). Treat it as
  agent-managed — review via git diff, don't hand-edit it.

Both files are read on every `draft` run and passed to the BA agent as
two separately labeled context sections (see `src/baAgent.ts`).

Not wired into real retrieval yet — everything here is passed as flat
context on every run. If either file grows past a handful of entries,
that's the signal to add real retrieval (embeddings + search) instead.
