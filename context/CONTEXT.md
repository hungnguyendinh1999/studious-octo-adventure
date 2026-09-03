# ADLC (AI Development Lifecycle)

Local-first pipeline where AI agents draft artifacts at each SDLC stage and humans gate each stage before it proceeds. Phase 1 (Requirements) and Phase 2 (Design) are both built.

## Language

**Work Item**:
One feature-sized slice of work, tracked end-to-end by a single id across every phase (Requirements, Design, Coding, ...). Created once from a folder of raw input documents; every phase hangs its artifacts off the same Work Item rather than minting a new one.
_Avoid_: Ticket, task, request (these are informal; Work Item is the tracked entity)

**Requirements Artifact (PRD)**:
The single Requirements-stage document: Problem Statement, Goals, Non-Goals, User Stories, Acceptance Criteria, Open Questions. One per Work Item, versioned.
_Avoid_: Feature Matrix (explicitly rejected — Priority/Module tag inline per story instead), Spec (too generic)

**UX/UI Spec**:
Design-stage artifact describing the user-facing surface of a Work Item: screens/flows, interaction detail per screen, content/copy, accessibility notes. Text-only (markdown, inline Mermaid for flow diagrams); no binary assets. Not produced for a Work Item with no user-facing surface (e.g. a backend/API-only change).
_Avoid_: Design doc (ambiguous with Technical/System Design), Mockup (implies visual assets, which this isn't)

**Technical/System Design**:
Design-stage artifact describing the technical solution for a Work Item: architecture overview, data model changes, API/interface contracts, alternatives considered, non-functional considerations. This is where SSD/TDD content lives (CLAUDE.md defers those explicitly to Design). Drafting it requires reading the actual target-repo source — it must be grounded in real code, not just the PRD.
_Avoid_: SSD, TDD (used as informal aliases only; Technical/System Design is canonical), Architecture doc (too narrow — this also covers data model and API contracts)

**Gate**:
A human review checkpoint on an artifact: draft → review → approve OR request-changes (loop back to the agent with feedback). Every gate transition is a deterministic, no-model CLI subcommand (structurally enforced audit write). Approval signal is the literal word "approve"/"approved" — no fuzzy matching.
_Avoid_: Review (too informal — Gate implies the structural/audit guarantee), Checkpoint

**Knowledge Base**:
Human-curated domain facts, conventions, and access notes (`context/knowledge-base.md`). Agents read it, never write to it.
_Avoid_: Context (too generic — this is specifically the human-curated store, as opposed to Context Lake)

**Context Lake**:
Agent-written durable knowledge distilled from *approved* decisions only (`context/context-lake.md`). Updated after a Gate approval via a dedicated skill + deterministic audit-write subcommand, never from a draft still in review.
_Avoid_: Cache, history (Context Lake is curated distillation, not a raw log)
