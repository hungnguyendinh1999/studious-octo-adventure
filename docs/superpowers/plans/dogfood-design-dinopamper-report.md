# Dogfood report: Design stage (`draft-design-ux.md` + `draft-design-tech.md`) against DinoPamper

**Date:** 2026-09-03 \
**Run type:** Cold-agent dogfood of the ADLC Design skill files against a real
target repo (DinoPamper), following the Requirements-stage dogfood run's
precedent. No `ai-sdlc-phase1` CLI commands were run; no `context/`
scaffolding exists or was created in DinoPamper; nothing was committed in
DinoPamper.

## What I produced

- `DinoPamper/docs/at-a-glance-dashboard-ux-spec-draft.md` — UX/UI Spec,
  five sections per `skills/draft-design-ux.md` (Screens/Flows, Interaction
  Detail, Content, Accessibility Notes, Open Questions). Single screen
  (Timeline), two small Mermaid state diagrams (sleep indicator, milk
  banner), six Open Questions.
- `DinoPamper/docs/at-a-glance-dashboard-tech-design-draft.md` —
  Technical/System Design, six sections per `skills/draft-design-tech.md`.
  Proposes a nullable `ended_at` column on the `entries` table to represent
  open sleep sessions, three new/extended functions in `db/entries.ts`, a
  new `MilkStatus` enum replacing the current boolean, and flags a real
  migration-idempotency gap found by reading `db/schema.ts`. Six Open
  Questions.

## Step 0 — UX applicability decision

Applies. Read all four user stories in the PRD before deciding: US-1 (elapsed
time on Timeline), US-2 (live sleep indicator, tappable), US-3 (milk warning
visual state), US-4 (expired milk persists visually) are all screen-facing —
none is backend/API/data-only. This was not a close call; every story names
a Timeline behavior a caregiver sees or taps.

## What I read in DinoPamper's source, and what it changed in the design

Read in full: `db/schema.ts`, `db/entries.ts`, `lib/feedingEstimates.ts`,
`config/feeding.ts`, `screens/TimelineScreen.tsx` (the PRD's named files),
plus `screens/QuickLogScreen.tsx`, `storage/nightWindow.ts`, `theme/theme.ts`,
`README.md`, `CLAUDE.md`, `NEW_REQUEST.md` for surrounding context.

Concretely, three things I could not have written from the PRD text alone:

1. **`db/schema.ts` is a single `CREATE TABLE IF NOT EXISTS`, no migration
   versioning at all.** This directly produced a Non-Functional Consideration
   and an Open Question that doesn't exist anywhere in the PRD: `ALTER TABLE
   ADD COLUMN` isn't idempotent the way `CREATE TABLE IF NOT EXISTS` is, so
   adding the `ended_at` column needs either a `PRAGMA table_info` guard or a
   try/catch to stay safe on every app launch. A design drafted from the PRD
   alone would have no way to know this matters, because the PRD never
   mentions how migrations work today.
2. **`db/entries.ts`'s `getLastEntryByType` is already generic over
   `EntryType`.** This meant US-1's diaper elapsed-time line needs zero new
   queries — a detail I flagged explicitly in the design as "no new query
   needed," which is exactly the kind of "don't propose something that
   already exists" check the skill file asks for. Without reading the file
   I'd have had no way to know this function already covers `'diaper'`.
3. **The `entries` table has no start/end concept at all** — it's a flat
   `(id, type, created_at)` row per event. This is what makes PRD Open
   Question 1 (sleep-session tracking gap) a real, load-bearing technical
   question rather than a footnote: the schema genuinely has nowhere to put
   "this sleep is still open." That drove the largest section of the tech
   design (the `ended_at` column proposal, three alternatives considered,
   and the backfill-for-historical-rows risk, which I would not have thought
   to raise without seeing that `migrateDbIfNeeded` has no backfill
   mechanism today).

I also compared the source `NEW_REQUEST.md`'s own suggested data model
(paired `sleep_start`/`sleep_end` event types) against what the actual schema
and rendering code (`theme/theme.ts`'s `entryTypeStyles`, the `FlatList` in
`TimelineScreen.tsx`) assume, and rejected it in Alternatives Considered
because it breaks the one-row-per-event assumption baked into those files —
a comparison that's only possible by reading both documents and the actual
render code.

**Bottom line on the "required repo exploration" instruction:** it was
genuinely followable and genuinely necessary, not a formality. All three
findings above are things a from-the-PRD-alone draft would either miss
entirely (the migration-idempotency risk) or get subtly wrong (proposing a
new diaper query that already exists; not noticing the schema has zero
session-tracking primitives to build on). I did not find myself wanting to
skip this step.

## Honest friction / gaps account

This is the main section — nothing below is softened.

**1. The context/knowledge-base.md and context-lake.md "stop and tell the
human" rule has no branch for this exact, now-recurring situation.**
Both `draft-design-ux.md` and `draft-design-tech.md` say, near-verbatim: "If
either file does not exist at all, stop and tell the human, same rule as
`skills/draft-requirements.md`." Literally followed, that means I should have
stopped before drafting either document, because neither `context/`
directory exists in DinoPamper. The only reason I didn't stop is that the
PRD draft I was handed documents a precedent from the earlier Requirements
dogfood run (README.md + CLAUDE.md as knowledge-base stand-in, empty context
lake accepted as "first run," not "missing scaffolding"), and my own
instructions told me to treat that PRD as approved input. But the *skill
files themselves* have no awareness of that precedent — a cold agent with
only the skill file and no PRD header note would stop here, correctly, per
the literal text. This is now the second stage (Requirements, then Design)
where this exact situation has come up and been worked around by an
out-of-band note rather than by the process itself. If DinoPamper (or any
repo without scaffolding) is going to keep being used as a dogfood target,
the skill files or the instruction template should say explicitly: "if a
prior stage's approved artifact documents a knowledge-base/context-lake
stand-in, follow the same stand-in — don't re-ask the stop question every
stage." Right now that convention lives only in a PRD header, which is
fragile — it won't survive to a design run that doesn't happen to inherit
that specific PRD file's prose.

**2. `draft-design-ux.md`'s "make a reasonable assumption and flag it"
rule collided with a PRD that had already flagged the same ambiguity as
*blocking*, and the skill doesn't say how to weight that.** PRD Open
Question 1 says outright: "US-2 can't ship without resolving this — the
single largest gap in this request." The UX skill's rule is "if the PRD is
ambiguous about a screen's behavior, make a reasonable assumption and flag
it in Open Questions rather than leaving it undefined" — which is written
for garden-variety ambiguity, not for an ambiguity the upstream document
itself has already flagged as potentially schema-blocking. I made the call
to draft the UX spec assuming the sleep session concept *does* get resolved
(describing what the caregiver sees/taps) and re-flag the same gap rather
than halting UX work over a Requirements-stage open question — that felt
like the right call, since the UX layer genuinely doesn't need to know
*how* sleep sessions are represented, only that the caregiver taps something
to end one. But the skill file doesn't distinguish "ambiguous detail, assume
and flag" from "the PRD says this might block the whole story" — it would
be worth a sentence clarifying that a PRD-flagged blocking gap doesn't halt
UX/tech drafting on its own, since the two stages can legitimately draft
around an unresolved data question as long as they don't need to know the
resolution to do their own job.

**3. `draft-design-tech.md`'s "do not invent business rules that materially
change scope" rule genuinely strained against the mandatory Data Model
section when the PRD explicitly left the underlying model unresolved.**
Section 2 (Data Model) is mandatory output; PRD Open Question 1 explicitly
declines to resolve whether/how sleep sessions are tracked. I had to decide
myself whether proposing a concrete schema change (the nullable `ended_at`
column) counts as "inventing a business rule that materially changes scope"
(which the rules forbid) or is squarely a technical modeling decision the
tech design is supposed to make (which section 2 requires). I concluded the
latter — the *business* decision (caregivers can see live sleep duration)
was already made in the PRD; *how* to represent that in SQLite is exactly
what this stage is for — and wrote the Open Questions section to make clear
this design's schema proposal is not itself an authoritative resolution of
PRD Open Question 1, just a well-grounded proposal for the tech lead to
confirm. I'm fairly confident this was the right read, but the skill file
doesn't spell out this distinction (business rule vs. technical modeling
choice) anywhere, and a less careful agent could go either direction —
silently invent a resolution and present it as settled, or refuse to fill in
section 2 at all and leave the design incomplete. A one-line clarification
in the Rules ("a PRD-flagged data-model gap is normally exactly what this
stage should propose a concrete resolution for, flagged in Open Questions —
that's different from inventing new business/product scope") would remove
the guesswork.

**4. Minor: the skill's "US-n" cross-referencing instruction (UX spec,
section 2) doesn't say what to do when the PRD's own acceptance criteria
are internally inconsistent about story boundaries.** US-2's acceptance
criteria reference "the standard 'Last slept X ago' state (US-1's
pattern)," but US-1's own stories/ACs only ever mention Last Fed and Last
Diaper — sleep is never named in US-1. So is the "Last slept" line US-1
scope (silently), US-2 scope, or an assumption bridging the two? I picked
"describe it, flag the ambiguity" (Open Question 2 in the UX spec) rather
than guessing which story number owns it, since the skill's cross-referencing
instruction assumes each interaction cleanly maps to one story number and
this one doesn't.

**5. No friction finding both skill files' Rules sections themselves
contradictory or their required-section lists ambiguous** — the five/six
section structures were unambiguous to follow, and the "no
implementation detail in UX spec / no literal code in tech design" split
was easy to keep clean in practice (I never felt tempted to put component
names in the UX spec or write actual TypeScript in the tech design).

## UX-first-then-Tech handoff: did it actually help?

Yes, materially — this wasn't a token cross-reference. Concretely:

- The tech design's `endSleepEntry` function and the new tap handler in
  `TimelineScreen.tsx` exist *because* the UX spec committed to "tapping the
  active indicator ends the session" as the interaction (UX spec Open
  Question 1, carried as an assumption). Without a drafted UX spec to read
  first, the tech design would have had to independently decide the
  interaction shape before it could design the API — the ordering the
  instruction template specifies (write UX, then read it before drafting
  tech) meant that decision only got made once.
- The UX spec's Open Question 5 (editing an open sleep entry via the
  existing modal is undefined) fed directly into the tech design's Open
  Question 6 — the tech design explicitly declined to extend `updateEntry`
  or the modal for the open-session case, citing the UX spec's own
  unresolved question, rather than silently inventing modal behavior.
- The UX spec's three-state milk banner (Normal/Warning/Expired, with
  distinct copy and iconography specified) directly shaped the tech design's
  choice of a `MilkStatus` enum over two independent booleans — the UX spec
  having already established the states are mutually exclusive from a
  caregiver's point of view made the enum the obvious technical shape.

I don't think the tech design would have been meaningfully worse without a
UX spec to reference — most of the real technical substance (the schema gap,
the migration-idempotency risk) came from reading the source code, not the
UX spec. But the interaction-shape decisions (tap-to-end, the modal
question) would have had to be made twice, once implicitly inside the tech
design and once if a UX spec were drafted later — the ordering avoided that
duplication cleanly.

## Recommended concrete edits

1. **`instruction-template-design.md` (or both skill files' Input
   sections):** add an explicit branch for "target repo has no `context/`
   scaffolding but a prior approved artifact in this same work item's chain
   documents a stand-in" — say to follow that stand-in rather than
   re-triggering the stop condition. This is friction item 1 above.
2. **`draft-design-ux.md`, Rules section:** add a sentence distinguishing
   "PRD is ambiguous about a screen behavior, assume and flag" (routine)
   from "PRD explicitly flags a requirement as blocked pending a
   Requirements-stage decision" (the UX spec can still describe the intended
   *interaction* around that gap without waiting for it to resolve, and
   should re-flag rather than block). Friction item 2.
3. **`draft-design-tech.md`, Rules section:** add a sentence clarifying that
   a PRD-flagged data-model gap is normally exactly the kind of thing
   section 2 (Data Model) should propose a concrete, flagged resolution for
   — that's a technical modeling decision, not the "inventing a business
   rule that materially changes scope" the rules warn against elsewhere.
   Friction item 3.
4. **`draft-design-ux.md`, section 2 (Interaction Detail) instructions:**
   note that a PRD's own acceptance criteria can reference a UI element
   under one story number that isn't clearly declared as in-scope by any
   story's own text (as happened with US-2 referencing "US-1's pattern" for
   a line US-1 never names) — when that happens, describe the element and
   flag the story-boundary ambiguity in Open Questions rather than guessing
   which US-n owns it. Friction item 4.

None of these are structural problems with the skill files — the section
formats, the reuse-over-invention bias, and the required-repo-exploration
instruction all worked exactly as intended. The friction was entirely at
the edges: what to do when an upstream artifact has already flagged
something as unresolved or blocking, and how that interacts with this
stage's own "make a reasonable assumption and flag it" default.
