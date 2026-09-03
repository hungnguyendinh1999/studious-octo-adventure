# Split Design into two independently-gated artifact types, not one document

Phase 1's Requirements stage produces a single `RequirementsArtifact` (the PRD) with one Reviewer gate. For Design, we considered mirroring that shape with a single unified design document but decided against it: we're producing two separate, independently-versioned artifacts per Work Item — a **UX/UI Spec** and a **Technical/System Design** — each with its own Reviewer and its own approve/request-changes gate. A single tech lead reviewing UX copy, or a designer reviewing an API contract, isn't a real check; splitting the artifacts means each gate is reviewed by someone who actually understands what they're approving. A Work Item with no user-facing surface simply skips the UX Spec — decided by whoever kicks off Design, not enforced by any schema.

## Considered Options

- **One unified `DesignArtifact`** (like the PRD), one Reviewer gate covering both UX and technical content. Rejected: forces a single reviewer to credibly assess two different kinds of expertise, or produces a rubber-stamp gate.
- **Per-artifact-type reviewer, but tag it in Work Item config ahead of time** (a `context/roles.md` listing who's PIC for what). Deferred, not rejected outright — no felt friction yet (no Design Work Item has run through this process); reviewer identity stays free-text (`--by <name>`) for now, same trust model as Phase 1's `approve`. Revisit if/when a real multi-person coordination problem shows up.

## Consequences

- Both gates are required before Coding starts, when both artifacts exist for a Work Item (Technical Design only, when UX doesn't apply).
- Each artifact type gets its own version counter and audit-log actions, mirroring but not identical to Phase 1's `RequirementsArtifact` pattern.
- Nothing in `log-design-draft` checks that the Work Item's Requirements are
  actually approved before Design starts — that precondition is enforced
  only by prose (the skill files and instruction template telling the human
  to confirm `npm run show` shows `approved` first). This mirrors Phase 1's
  own precedent (the ordering between `create-work-item` and `log-draft` is
  also prose-enforced, not code-checked) and is a deliberate choice, not an
  oversight — revisit if this ordering is ever violated in practice.
