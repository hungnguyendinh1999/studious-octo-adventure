# Context Lake

Durable knowledge distilled from *approved* requirements documents.
Agent-written only.

**How entries get here:** after `approve`, the harness-agent follows
`skills/update-context-lake.md` itself, appends the resulting entries
directly to this file, then runs `log-context-update` to record that it
did. The `approve` command does not write here.

**Format:** append entries below the `---` as plain markdown — a `##`
heading per term, a 1-2 sentence definition, and the source work item as
`(from WI-<id>)`, where `<id>` is the id the CLI printed (e.g.
`WI-28sf3WW0`). No code fences.

Do not hand-edit casually; review changes via git diff.

---

## Task Management
Module responsible for creating, updating, viewing, and marking tasks as completed by users. (from WI-28sf3WW0)

## User Analytics
Area covering features for team leads to monitor the task counts of individual team members. (from WI-28sf3WW0)

## Notifications
Feature allowing optional reminders before due dates if specified. (from WI-28sf3WW0)

## SSO Login
Future enhancement requiring secure single sign-on login capability. (from WI-28sf3WW0)

## Limited Visibility
Users can only see their own tasks; team leads have visibility of task counts for each user but no access to individual task details. (from WI-28sf3WW0)
