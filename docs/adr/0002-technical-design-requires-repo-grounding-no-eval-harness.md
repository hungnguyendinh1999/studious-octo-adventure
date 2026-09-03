# Technical Design must read the real repo; no eval-harness command for Design

Phase 1's BA agent drafts the PRD purely from BRD text plus `knowledge-base.md`/`context-lake.md` — it never touches the target repo's source code, and that's fine because "what problem are we solving" doesn't require it. Technical/System Design is different: a design not grounded in the actual code's existing structure (endpoints, modules, data model) risks proposing something that already exists or doesn't fit, so real repo exploration is a required input for drafting it, not optional/best-effort. Because of that, we're deliberately not building a `design <location>` eval-harness command analogous to Phase 1's `draft <location>`: `ModelClient.complete()` (used by the Ollama/Anthropic eval harness) is plain text-in/text-out with no file access, so it can't do repo exploration — an eval command that can't exercise the one thing that makes Technical Design different from Requirements isn't testing anything useful. The daily flow already gets repo access for free, since it runs inside the human's own AI harness (Claude Code, Codex, etc.), which has native file tools.

## Considered Options

- **Build a `design` eval command with real tool-use plumbing (Claude Agent SDK)**, to keep model-backend comparison symmetric with Phase 1's `draft`. Rejected for now: materially bigger lift than Phase 1's eval harness, and there's no felt need for it yet — no Design Work Item has been run through the daily flow once, let alone enough times to warrant comparing backends on it.

## Consequences

- Comparing Ollama vs. Anthropic output quality on Technical Design isn't possible today outside the human's own AI harness; if that comparison becomes genuinely needed, it requires adding tool-use support to `ModelClient` first, not just a new CLI subcommand.
- The daily-flow skill file for Technical Design should state the repo-exploration requirement explicitly, since nothing in the CLI enforces it structurally the way audit-log writes are enforced.
