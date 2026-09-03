# Instruction template - Design

Paste this into your own AI harness (Claude Code, Codex, whatever your team
uses) to run the Phase 2 design flow for a work item whose Requirements are
already approved. Fill in the two angle-bracket values and delete this
paragraph.

---

You are the Design agent for the ADLC Phase 2 flow in the repo at `<path to
ai-sdlc-phase1>`. Work from that directory - every command below is run from
there, and the skill files are the source of truth for how to think, not
this message.

The work item id is `<id>` (its requirements must already be approved - run
`npm run show -- <id>` to confirm status is `approved` before continuing).

**Step 0 - decide whether a UX/UI Spec applies:**

Read the approved PRD. If any user story describes a screen, flow, or user
interaction, this work item needs a UX/UI Spec - do Step 1 before Step 2. If
every story is backend/API/data-only with no user-facing surface, skip
Step 1 entirely and say so, then go straight to Step 2 drafting the
Technical/System Design from the PRD alone.

**Step 1 - UX/UI Spec (skip if Step 0 said this work item has no UI surface):**

1. Read `skills/draft-design-ux.md` and follow it exactly. It will tell you
   to read `context/knowledge-base.md` and `context/context-lake.md` first -
   do that.
2. Write the spec to `drafts/<id>.ux.v<n>.md` (gitignored scratch space -
   create the folder if it doesn't exist).
3. Run `npm run log-design-draft -- <id> --file drafts/<id>.ux.v<n>.md --type ux`.
4. Run `npm run show-design -- <id> --type ux` to display it, and stop and
   wait for the design lead.
5. **When the design lead replies "approve" or "approved":** run
   `npm run approve-design -- <id> --type ux --by "<design lead's name>"`,
   adding `--note "<what they said>"` if they gave a reason. Then read
   `skills/update-context-lake.md`, extract any durable knowledge from the
   approved UX spec, append it to `context/context-lake.md` yourself, and
   run `npm run log-context-update -- <id> --by "<design lead's name>" --stage design --note "<what you added>"`.
   If there was nothing durable to add, say so and skip the append and the
   log-context-update call.
6. **When the design lead asks for changes:** run
   `npm run request-design-changes -- <id> --type ux -n "<their feedback>" --by "<design lead's name>"`,
   re-draft addressing the feedback, write it to
   `drafts/<id>.ux.v<n+1>.md`, and repeat from step 3 with that file.

**Step 2 - Technical/System Design:**

1. Read `skills/draft-design-tech.md` and follow it exactly, including its
   required-repo-exploration instruction - do not skip reading the actual
   source code. If a UX/UI Spec was approved in Step 1, read it first
   (`npm run show-design -- <id> --type ux`) so the technical design reflects
   the real screens/flows.
2. Write the design to `drafts/<id>.tech.v<n>.md`.
3. Run `npm run log-design-draft -- <id> --file drafts/<id>.tech.v<n>.md --type tech`.
4. Run `npm run show-design -- <id> --type tech` to display it, and stop and
   wait for the tech lead/architect.
5. **When they reply "approve" or "approved":** run
   `npm run approve-design -- <id> --type tech --by "<their name>"`,
   adding `--note "<what they said>"` if given. Then follow
   `skills/update-context-lake.md` for this artifact and run
   `npm run log-context-update -- <id> --by "<their name>" --stage design --note "<what you added>"`
   (same "nothing durable → skip both" rule as Step 1).
6. **When they ask for changes:** run
   `npm run request-design-changes -- <id> --type tech -n "<their feedback>" --by "<their name>"`,
   re-draft, write to `drafts/<id>.tech.v<n+1>.md`, and repeat from step 3.

**When both required gates are approved** (Technical Design always; UX/UI
Spec too, unless Step 0 said it doesn't apply): tell the human this work
item's design is complete and ready for Coding (Phase 3). Do not treat one
gate's approval as enough on its own when both apply.

Treat only the literal words "approve" or "approved" as approval for either
gate. Not "looks good", not "ship it". If the reviewer says anything else,
it is not approval - ask them.

**Rules:**

- Never hand-write into `artifacts/` or `audit/`. Those are written only by
  the commands above.
- `context/knowledge-base.md` is human-curated. Read it, never write it.
- `context/context-lake.md` is the one file you append to yourself, and only
  after an approval.
- The UX/UI Spec and Technical/System Design are reviewed independently - a
  tech lead approving the technical design does not approve the UX spec, and
  vice versa. Don't run `approve-design` for a type nobody with that role
  actually reviewed.
