# ADLC Phase 1 — BA Agent (Todo App Demo)

Runnable Phase 1 of the ADLC: one or more loose input documents (BRD,
notes, whatever exists) → agent-drafted requirements + feature matrix →
BA/PO gate (approve or request changes) → approved content feeds the
context lake for future runs. Intentionally thin — a CLI, a local
file-based artifact store, and an append-only audit log. Every piece is
designed to be swapped out; see below.

## What's here

- `skills/draft-requirements.md` — the BA agent's "brain": role, input
  handling (multiple documents, knowledge base + context lake context), output format
  (problem statement, goals, non-goals, user stories, feature matrix,
  acceptance criteria, open questions), and rules.
- `skills/update-context-lake.md` — a second, narrower skill: extracts
  only durable, reusable knowledge from an *approved* requirements doc.
  Runs after `approve`, never before.
- `src/baAgent.ts` — calls Claude with the requirements skill, given
  labeled input docs, knowledge base docs, and context lake docs.
- `src/contextLakeAgent.ts` — calls Claude with the context-lake skill,
  returns a markdown snippet to append (or nothing, if there's nothing
  durable to add). Used by the `draft` eval harness only — the daily
  `approve` flow no longer calls it (see below).
- `src/documentStore.ts` — the artifact store. Local filesystem for now
  (`artifacts/`), behind a `DocumentStore`-shaped interface so it can be
  swapped for Outline later without touching callers.
- `src/auditLog.ts` — append-only JSONL log (`audit/log.jsonl`), standing
  in for the insert-only Postgres table (and eventually immudb) from the
  design doc.
- `src/cli.ts` — orchestration entrypoint: `draft`, `show`, `approve`,
  `log-context-update`, `request-changes`, `list`, `audit`.
- `context/knowledge-base.md` — human-curated context. The agent reads
  it, never writes to it.
- `context/context-lake.md` — agent-written context. After `approve`,
  the harness-agent appends to this itself per
  `skills/update-context-lake.md`, then calls `log-context-update` to
  record that it did. Auto-loaded (alongside the knowledge base) on
  every `draft`.
- `requests/todo-app.md` + `requests/todo-app-notes.md` — two example
  input docs with slightly conflicting info, to demo how the agent
  reconciles (and flags) conflicts across documents.

## Setup

\`\`\`bash
npm install
cp .env.example .env
# edit .env and set OLLAMA_MODEL (must already be pulled, e.g. `ollama pull llama3.1`)
\`\`\`

## Run the demo

\`\`\`bash
# 1. Draft requirements from multiple loose input docs
npm run draft -- requests/todo-app.md requests/todo-app-notes.md --title "Todo App"
# → prints a work item id, e.g. "a1b2c3d4"

# 2. Read the draft (includes the feature matrix)
npm run show -- a1b2c3d4

# 3a. Approve it — writes the audit record only
npm run approve -- a1b2c3d4 --by "jane.ba" --note "Looks good"
# → then, as the harness-agent: follow skills/update-context-lake.md
#   yourself, append to context/context-lake.md, and record it:
npm run log-context-update -- a1b2c3d4 --by "jane.ba" --note "..."

# 3b. OR request changes (agent redrafts with your feedback)
npm run request-changes -- a1b2c3d4 --by "jane.ba" \
  --note "Split the due-date story out separately"

# See everything that happened to this work item
npm run audit -- a1b2c3d4

# See all work items and their status
npm run list

# Check whether the context lake actually grew
cat context/context-lake.md
\`\`\`

Every run writes:
- `artifacts/<id>/requirements.v<N>.md` — each draft, versioned
- `artifacts/<id>/requirements.latest.json` — current status + metadata
- `audit/log.jsonl` — one line per event (created, drafted, approved,
  changes requested, context lake updated); the approved and
  context-lake-updated events are each written by their own dedicated,
  deterministic subcommand (`approve`, `log-context-update`)
- `context/context-lake.md` — grows only after approval, only with
  durable knowledge (see the skill's rules on what counts)

## What's swappable (by design)

| Piece | Now | Later |
|---|---|---|
| Artifact store | Local filesystem | Outline (BA/PO already work there) |
| Audit log | Append-only JSONL | Postgres insert-only table → immudb |
| Agent execution | Direct Claude API call | Claude Agent SDK, if the agent needs broader tool access |
| Knowledge base / context lake | Flat markdown files, loaded whole | Real retrieval (embeddings + search) once either outgrows a few files |
| Orchestration | CLI | CI trigger / Slack bot / whatever fits the team's flow |

None of these swaps require changing `cli.ts`'s command logic — only the
implementation behind `DocumentStore`, the log writer, or how knowledge
base and context lake docs get loaded.

## Known gaps (expected — this is Phase 1 only)

- Feature matrix is markdown-table-only, not machine-parseable yet — fine
  for human review, will need a structured (JSON) form once Phase 3 needs
  to consume tasks programmatically
- No triage step yet (bounded/simple work still goes through the full
  flow — worth revisiting once you have real cycle-time data)
- Knowledge base is a flat file passed in full every run — no retrieval,
  no de-duplication beyond what the skill's own rules catch
- Single BA agent + context-lake agent only — Design (Phase 2) and Coding
  (Phase 3) agents aren't built yet, though they'll follow the same
  skill + `AgentStep`-style pattern
- No web UI — CLI only, on purpose, to keep this cheap to throw away or
  rework
