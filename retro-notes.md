# Retro notes

Session-by-session log. Newest entries at the bottom.

## 2026-08-26 — Audited 7-item build plan, split approve from context-lake update

**What happened:** Audited a 7-item Phase 0/1 build plan against actual
repo state. Found items 1 (CLAUDE.md decisions) and 2 (deterministic
approve subcommand) already substantially built. Surfaced and resolved
an architecture ambiguity in items 3-6, then implemented items 1 and 6.

**Decisions made:**
- Daily-use flow moves into the human's own AI harness (Claude Code,
  Codex) reading skill files directly; `cli.ts` narrows to (a)
  deterministic audit-write subcommands and (b) an eval-only `draft`
  harness for comparing model backends — not the daily product surface.
- `approve` is now audit-write only — no more inline `contextLakeAgent`/
  Ollama call. The harness-agent updates `context/context-lake.md`
  itself per `skills/update-context-lake.md`, then calls a new
  `log-context-update <workItemId>` subcommand (mirrors `approve`'s
  pattern, no model call) to record that it happened — keeps both
  approval and context-lake-update audit events structurally enforced
  instead of leaving the second one to agent discretion.
- `approve` now prints an explicit "Next step: follow
  skills/update-context-lake.md..." line after a successful write, so
  the harness-agent is told the next step rather than relying on
  remembering it from the skill file alone.
- Remaining build-plan items reordered from the user's original 1-7 to
  1 → 6 → 4 → 3 → 7 → 5, so later items can reference the finalized
  `approve`/`log-context-update` shape instead of a moving target.

**Open questions / follow-ups:**
- Item 4 next: add explicit instruction to `skills/draft-requirements.md`
  to read `context/knowledge-base.md` and `context/context-lake.md`
  itself when not already fed in (dual-mode wording for both the CLI
  eval-harness path and a harness-agent invoked directly).
- Then item 3 (BRD location as a folder, not explicit file list), item 7
  (relabel `draft`/`ModelClient` as eval-only in code/README), item 5
  (instruction template + fresh-subagent dogfood test).
- `context/context-lake.md` and `skills/draft-requirements.md` have a
  pre-existing uncommitted diff (PRD/no-Feature-Matrix restructuring,
  predates this session) intentionally left uncommitted until item 4
  touches that file.

## 2026-08-26 — Finished build plan; dogfood test found 4 real defects

**What happened:** Finished all 7 build-plan items. Discovered mid-way
that the daily flow could not actually run (nothing outside the
eval-only `draft` created a work item or a v1 draft, so `approve` failed
with ENOENT) and closed it with two new deterministic subcommands. Then
dogfooded the instruction template against a fresh subagent with no
conversation context and an unfamiliar BRD, which surfaced four genuine
defects.

**Decisions made:**
- Every state transition in the daily flow is now its own deterministic,
  no-model subcommand: `create-work-item`, `log-draft`, `approve`,
  `request-changes`, `log-context-update`. The agent thinks, the CLI
  records. CLAUDE.md's structural-enforcement bullet was widened to say
  so explicitly.
- `request-changes` no longer re-runs the BA agent — it marks the draft
  `changes_requested` (a GateStatus that existed in types.ts but had
  never been set by any code path) and the harness-agent re-drafts.
  Both gate outcomes now work identically.
- `log-draft` derives the version from what's already stored rather than
  taking it as an argument, so a re-draft after `request-changes`
  becomes v2 without the caller tracking state.
- Dogfooding via a zero-context subagent is worth repeating for skill
  and template changes — it found things review didn't, because it had
  to actually follow the instructions rather than recognize them.

**Open questions / follow-ups:**
- **No amend path.** An agent that spots its own error after `log-draft`
  can only run `log-draft` again, producing two consecutive
  `agent_drafted_requirements` events with no gate between them — the
  trail then implies reviewer feedback that never happened. Either bless
  this explicitly or add an amend/replace verb. Template currently tells
  the agent to surface it to the human instead.
- **Context lake is not scoped per product.** It is one flat file, today
  holding only todo-app entries. `draft-requirements.md` says to follow
  existing names rather than invent new ones, which — read literally —
  pushes an unrelated product's PRD toward reusing e.g. `Notifications`
  from a different product. Gets worse with each product added. Needs
  per-product scoping or a relevance filter before a second product is
  run through for real.
- **`context/knowledge-base.md` is effectively empty** (a header
  describing itself, no domain content), while the skill instructs the
  agent to treat it as established fact. Template now tells the agent to
  proceed and flag assumptions, but the knowledge base should get real
  content before this is used in anger.
- **`log-draft` version-to-source mapping is invisible.** Running it
  twice from the same path silently increments the version with nothing
  recording which source file produced which version. Template works
  around this by convention (`drafts/<id>.v<n>.md`); nothing enforces it.
