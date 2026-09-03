# ADLC Phase 1 — BA Agent (Todo App Demo)

Runnable Phase 1 of the ADLC: a folder of loose input documents (BRD,
notes, whatever exists) → agent-drafted PRD → BA/PO gate (approve or
request changes) → approved content feeds the context lake for future
runs. Intentionally thin — a CLI, a local file-based artifact store, and
an append-only audit log. Every piece is designed to be swapped out; see
below.

## What's here

- `skills/draft-requirements.md` — the BA agent's "brain": role, input
  handling (a folder of documents, knowledge base + context lake
  context), output format (problem statement, goals, non-goals, user
  stories with inline priority/module tags, acceptance criteria, open
  questions), and rules.
- `skills/update-context-lake.md` — a second, narrower skill: extracts
  only durable, reusable knowledge from an *approved* requirements doc.
  Runs after `approve`, never before.
- `skills/draft-design-ux.md` - the UX/UI Spec skill. Only runs when the
  work item has a user-facing surface.
- `skills/draft-design-tech.md` - the Technical/System Design skill.
  Requires reading the actual target repo's source before drafting.
- `skills/instruction-template-design.md` - paste-in template for the
  Design flow, mirroring `skills/instruction-template.md` for
  Requirements.
- `src/baAgent.ts` — feeds the requirements skill to a `ModelClient`,
  given labeled input docs, knowledge base docs, and context lake docs.
  Eval harness only (see below).
- `src/contextLakeAgent.ts` — same, for the context-lake skill; returns
  a markdown snippet to append (or nothing, if there's nothing durable
  to add). Eval harness only — the daily `approve` flow no longer calls
  it.
- `src/inputLoader.ts` — reads a BRD folder into labeled docs (skips
  dotfiles and subdirectories, sorted for determinism).
- `src/documentStore.ts` — the artifact store. Local filesystem for now
  (`artifacts/`), behind a `DocumentStore`-shaped interface so it can be
  swapped for Outline later without touching callers.
- `src/auditLog.ts` — append-only JSONL log (`audit/log.jsonl`), standing
  in for the insert-only Postgres table (and eventually immudb) from the
  design doc.
- `src/cli.ts` - entrypoint. Deterministic writes for Requirements
  (`create-work-item`, `log-draft`, `approve`, `request-changes`) and for
  Design (`log-design-draft`, `approve-design`, `request-design-changes`,
  each taking `--type ux|tech`), a shared `log-context-update` (now
  stage-aware), read verbs (`show`, `show-design`, `list`, `audit`), and
  the eval-only `draft`.
- `context/knowledge-base.md` — human-curated context. The agent reads
  it, never writes to it.
- `context/context-lake.md` — agent-written context. After `approve`,
  the harness-agent appends to this itself per
  `skills/update-context-lake.md`, then calls `log-context-update` to
  record that it did. Auto-loaded (alongside the knowledge base) on
  every `draft`.
- `requests/` — the BRD location for the demo: two example input docs
  (`todo-app.md`, `todo-app-notes.md`) with slightly conflicting info,
  to show how the agent reconciles (and flags) conflicts across
  documents in the same folder.

## Setup

\`\`\`bash
npm install
cp .env.example .env
# edit .env and set OLLAMA_MODEL (must already be pulled, e.g. `ollama pull llama3.1`)
\`\`\`

## Daily use

Day to day, the model work happens in **your own AI harness** (Claude
Code, Codex, whatever your team picked) — not through this CLI. Point
your harness at `skills/draft-requirements.md` and a BRD folder; it
reads the knowledge base and context lake itself, drafts the PRD, and
writes it into `artifacts/`.

The CLI's job in that flow is the **deterministic writes only** — the
parts that must happen identically every time, regardless of which
model or harness is driving. None of these call a model:

\`\`\`bash
# 1. Mint a work item from the BRD folder
npm run create-work-item -- requests --title "Todo App"
# → prints a work item id, e.g. "a1b2c3d4"

# 2. Draft the PRD yourself per skills/draft-requirements.md, then hand
#    the file over to be versioned + logged
npm run log-draft -- a1b2c3d4 --file /tmp/prd-draft.md

# 3. BA/PO reviews it
npm run show -- a1b2c3d4

# 4a. Gate: approve. Writes the audit record. Nothing else.
npm run approve -- a1b2c3d4 --by "jane.ba" --note "Looks good"
# → then, as the harness-agent: follow skills/update-context-lake.md
#   yourself, append to context/context-lake.md, and record that you did:
npm run log-context-update -- a1b2c3d4 --by "jane.ba" --note "..."

# 4b. Gate: request changes instead. Marks the draft changes_requested
#     and writes the audit record; you do the re-draft, then log-draft
#     again (it auto-increments to v2).
npm run request-changes -- a1b2c3d4 --by "jane.ba" \
  --note "Split the due-date story out separately"

# See history / list work items
npm run audit -- a1b2c3d4
npm run list
\`\`\`

Why the split: an audit record that depends on an agent remembering to
write it isn't an audit record. `approve` and `log-context-update` are
plain subcommands with no model call in them, so the trail survives
even if agent behavior drifts. See CLAUDE.md's "audit-log write is
structurally enforced" decision.

## Design (Phase 2) daily use

Same shape as Requirements: your own AI harness does the drafting, the CLI
does the deterministic writes. Two independently-gated artifact types per
work item - see `docs/adr/0001-split-design-artifacts-and-gates.md` for why.

\`\`\`bash
# 0. Confirm requirements are approved
npm run show -- a1b2c3d4

# 1. UX/UI Spec (skip if this work item has no user-facing surface)
#    Draft per skills/draft-design-ux.md, then:
npm run log-design-draft -- a1b2c3d4 --file /tmp/ux-draft.md --type ux
npm run show-design -- a1b2c3d4 --type ux
npm run approve-design -- a1b2c3d4 --type ux --by "design.lead"
npm run log-context-update -- a1b2c3d4 --by "design.lead" --stage design --note "..."

# 2. Technical/System Design - requires reading the actual target repo
#    first (skills/draft-design-tech.md enforces this), then:
npm run log-design-draft -- a1b2c3d4 --file /tmp/tech-draft.md --type tech
npm run show-design -- a1b2c3d4 --type tech
npm run approve-design -- a1b2c3d4 --type tech --by "tech.lead"
npm run log-context-update -- a1b2c3d4 --by "tech.lead" --stage design --note "..."

# Request changes instead of approving, for either type:
npm run request-design-changes -- a1b2c3d4 --type tech \
  --by "tech.lead" -n "cover the pagination case"
\`\`\`

Both gates are required before Coding, when both artifact types apply to
the work item (Technical Design always does; the UX/UI Spec only when
there's a user-facing surface).

## Evaluation harness (internal, not the daily flow)

`npm run draft` and the `ModelClient` interface behind it exist to
**compare model backends** against the same skill file — swap
`OLLAMA_MODEL`, re-run, diff the output. It is not a daily product
surface, and nothing in the daily flow depends on it.

\`\`\`bash
# Draft requirements from a folder of loose input docs, via ModelClient
npm run draft -- requests --title "Todo App"
# → prints a work item id, e.g. "a1b2c3d4"

npm run show -- a1b2c3d4
\`\`\`

## What gets written (either flow)

- `artifacts/<id>/requirements.v<N>.md` — each draft, versioned
- `artifacts/<id>/requirements.latest.json` — current status + metadata
- `audit/log.jsonl` — one line per event (created, drafted, approved,
  changes requested, context lake updated); the approved and
  context-lake-updated events are each written by their own dedicated,
  deterministic subcommand (`approve`, `log-context-update`)
- `context/context-lake.md` — grows only after approval, only with
  durable knowledge (see the skill's rules on what counts)
- `artifacts/<id>/design-ux.v<N>.md` / `design-tech.v<N>.md` - each
  design draft, versioned independently per type
- `artifacts/<id>/design-ux.latest.json` / `design-tech.latest.json` -
  current status + metadata per type

## What's swappable (by design)

| Piece | Now | Later |
|---|---|---|
| Artifact store | Local filesystem | Outline (BA/PO already work there) |
| Audit log | Append-only JSONL | Postgres insert-only table → immudb |
| Agent execution (eval harness only) | `ModelClient` → Ollama | Any other backend behind the same interface; daily flow uses your own harness instead |
| Knowledge base / context lake | Flat markdown files, loaded whole | Real retrieval (embeddings + search) once either outgrows a few files |
| Orchestration | CLI | CI trigger / Slack bot / whatever fits the team's flow |

None of these swaps require changing `cli.ts`'s command logic — only the
implementation behind `DocumentStore`, the log writer, or how knowledge
base and context lake docs get loaded.

## Known gaps (expected — this is Phase 1 only)

- PRD is markdown-only, not machine-parseable yet — fine for human
  review, will need a structured (JSON) form once Phase 3 needs to
  consume user stories programmatically
- No triage step yet (bounded/simple work still goes through the full
  flow — worth revisiting once you have real cycle-time data)
- Knowledge base is a flat file passed in full every run — no retrieval,
  no de-duplication beyond what the skill's own rules catch
- Coding (Phase 3) isn't built yet, though it'll follow the same
  skill + deterministic-subcommand pattern as Requirements and Design
- No roles/PIC config - reviewer identity for both Design gates is
  free-text (`--by <name>`), same trust model as Requirements
- No web UI — CLI only, on purpose, to keep this cheap to throw away or
  rework
