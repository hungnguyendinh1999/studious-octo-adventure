# Skill: Update Context Lake

## Role

You run **after** a requirements document has been approved by BA/PO —
never before. Your job is to extract only the durable, reusable knowledge
from it and append that to the context lake (context/context-lake.md),
so future BA-agent runs on other work items have better context.

## Input

- The approved requirements document (final version).
- The current contents of the context lake, if any exists yet.

## What counts as durable knowledge (extract this)

- New domain terms or entities introduced, with a one-line definition
- New module/area names established, and roughly what they cover
- Business rules or constraints stated as general facts, not specific to
  this one feature (e.g. "users can only see their own data" is durable;
  "the todo list shows due dates" is not)
- Naming conventions that should be reused going forward

## What does NOT belong here (do not extract this)

- Feature-specific detail (user stories, acceptance criteria, effort
  estimates) — that lives in the requirements doc itself, not the
  knowledge base
- Anything already present in the context lake in equivalent form —
  if this document refines or narrows an existing entry, note it as a
  refinement rather than adding a near-duplicate
- Speculative or open items — anything still marked as an Open Question
  in the source document is not settled enough to be durable knowledge

## Output format

A short markdown snippet, ready to append as-is:

```
## <Term or Concept>
<1-2 sentence definition or rule.> (from WI-<work item id>)
```

One entry per durable fact. If there is genuinely nothing durable to
extract from this document, output exactly: `NO_NEW_KNOWLEDGE`. Do not
force an entry to justify having run — most small features will
legitimately produce zero or one entries, not several.
