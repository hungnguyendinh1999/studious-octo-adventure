# ADLC Phase 1 — Project Memory

## What this is

Local-first ADLC (AI Development Lifecycle): AI agents draft artifacts at
each SDLC stage, humans gate each stage before it proceeds. This repo is
**Phase 1 only**: raw request docs (BRD) → agent-drafted PRD → BA/PO
approval gate → context lake update.

## Settled decisions — do not relitigate these

- **Local-first.** CLI + filesystem, no cloud hosting, no dashboard, no
  auth, no multi-tenancy. Revisit only once the process itself is
  validated with real usage.
- **Core banking / Temenos T24 is NOT the pilot target.** Too much
  compliance overhead to validate the mechanism quickly. Prove it on
  something small first; bring the pattern to core banking later.
- **Requirements stage (Phase 1) outputs a single PRD document.** No
  separate Feature Matrix — Priority and Module/Area are tagged inline
  per user story instead. No SSD/TDD here either — those belong to
  Design (Phase 2) or later, if used at all.
- **Every stage transition is a human gate**: draft → review → approve OR
  request-changes (loop back to the agent with feedback). Never skip
  logging a transition, including loop-backs.
- **Audit-log write is structurally enforced.** Approval must trigger a
  callable CLI subcommand that performs the JSONL write — never left to
  agent discretion, never invoked implicitly elsewhere in the flow. This
  is the guarantee that survives even if agent behavior drifts.
- **Approval signal is the literal word "approve" or "approved."** No
  fuzzy matching, no inferred sentiment.
- **BRD "location" is a folder of one or more documents**, not a single
  file — preserves multi-document conflict detection.
- **Model swapping is not this repo's responsibility.** Project teams
  self-select their own AI harness (Claude Code, Codex, Ollama, etc.)
  independently. The `ModelClient`/`draft` CLI here is a thin internal
  evaluation harness only, not a daily product surface.
- **Notification is out of scope for this repo.** Native tool
  notifications (per team, per harness) handle it — not something
  this codebase implements.

## Three-store architecture — do not conflate these

- **Knowledge Base** (`context/knowledge-base.md`): human-curated only.
  Domain facts, conventions, access notes. The agent reads it, never
  writes to it.
- **Context Lake** (`context/context-lake.md`): agent-written only.
  After `approve`, the harness-agent follows `skills/update-context-lake.md`
  itself (using its own model) to generate the update and append it
  directly, then calls `log-context-update` — a second deterministic
  audit-write subcommand, mirroring `approve`'s — to record that it
  happened. `src/contextLakeAgent.ts` still exists but is no longer
  called from `approve`; it's available only to the `draft` eval harness.
  Populated only from *approved* decisions — never from a draft still in
  review.
- **Artifact Store** (`src/documentStore.ts`, `artifacts/`): versioned
  per-stage outputs. Local filesystem now, behind a swappable
  `DocumentStore` interface — Outline is the likely future backend since
  BA/PO already work there.

## Swappable-by-design interfaces — keep them swappable

- `DocumentStore` — local FS now, Outline later
- Agent execution (`baAgent.ts`, `contextLakeAgent.ts`) — goes through the
  `ModelClient` interface (`src/modelClient.ts`). `OllamaModelClient` is
  the active backend (local, via Ollama's OpenAI-compatible endpoint).
  `AnthropicModelClient` is kept intact and exported but unused, so
  reverting to it is a one-line change in `cli.ts`. Claude Agent SDK
  remains an option later if a stage needs broader tool access (e.g.
  real repo exploration for Design).
- Audit log (`src/auditLog.ts`) — append-only JSONL now; Postgres
  insert-only table, then immudb, later. Same event shape either way.

Do not hardcode a specific backend into a caller — go through the
interface.

## Phases (this repo is Phase 1 only)

1. **Requirements Analysis** (this repo) — BA agent, PRD, BA/PO gate
2. **Design** (not built yet) — same flow, different skill + tools
   (design specs, UI/UX), Reviewer gate
3. **Coding** — task breakdown (human-gated) → test-first RED (CI-
   verified) → implement to GREEN (CI-verified) → PR review (human-gated)
4. **Build/CI, SIT, UAT, deployment** — a validated DevSecOps pipeline
   already exists for Temenos T24 covering post-code-complete stages;
   don't redesign that, integrate with it later if this ever reaches
   core banking.

## Conventions

- TypeScript, Node, ESM (`"type": "module"`); one command per CLI verb in
  `src/cli.ts` (commander)
- Skill files (`skills/*.md`) are the actual "agent brain" — treat edits
  to them as the primary way behavior changes, not prompt strings buried
  in `.ts` files
- `npm install && cp .env.example .env`, then set `OLLAMA_MODEL` (and
  optionally `OLLAMA_BASE_URL`) before running anything. `ANTHROPIC_API_KEY`
  is only relevant if `cli.ts` is switched back to `AnthropicModelClient`.