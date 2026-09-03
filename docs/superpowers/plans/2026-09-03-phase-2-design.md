# Phase 2 (Design) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Design stage to the ADLC repo - two independently-gated artifact types (UX/UI Spec, Technical/System Design) per Work Item, following Phase 1's deterministic-audit-subcommand shape.

**Architecture:** Extend the existing `WorkItem`/`DocumentStore`/`cli.ts` machinery with a second artifact kind (`DesignArtifact`, typed `ux_spec` | `tech_design`) instead of a new entity. Each type gets its own version counter, its own file prefix (`design-ux.*` / `design-tech.*`), and its own approve/request-changes gate - mirroring `RequirementsArtifact` but parametrized by `--type`. No new storage backend, no binary assets, no new eval-harness command.

**Tech Stack:** TypeScript (strict), Node ESM, Commander, `node:test` + `node:assert/strict`, `tsx`.

**Spec:** `docs/adr/0001-split-design-artifacts-and-gates.md`, `docs/adr/0002-technical-design-requires-repo-grounding-no-eval-harness.md`, `context/CONTEXT.md` (this repo's grilling interview produced these; there is no separate spec doc).

## Global Constraints

- Design artifacts are text-only markdown (Mermaid for diagrams) - no binary/image asset storage.
- Reviewer identity stays free-text (`--by <name>`), same trust model as Phase 1's `approve` - no roles/PIC config file.
- Approval signal is the literal word "approve"/"approved" only - no fuzzy matching (unchanged from Phase 1, applies to Design too).
- Every state transition is a deterministic, no-model CLI subcommand - the audit write is structural, never left to agent discretion.
- No `design` eval-harness command analogous to `draft` (see ADR 0002).
- UX/UI Spec is optional per Work Item (skipped when there's no user-facing surface); Technical/System Design is required for every Work Item that reaches Design.

---

### Task 1: `DesignArtifact` type, store methods, and `log-design-draft` command

**Files:**
- Modify: `src/types.ts`
- Modify: `src/documentStore.ts`
- Modify: `src/cli.ts:1-27` (imports + new helpers), and add a new command block
- Modify: `package.json` (scripts)
- Create: `test/designFlow.test.ts`

**Interfaces:**
- Produces: `DesignArtifactType = "ux_spec" | "tech_design"`, `DesignArtifact` (fields: `workItemId: string; type: DesignArtifactType; version: number; content: string; status: GateStatus; createdAt: string; reviewNote?: string; reviewedBy?: string; reviewedAt?: string;`), `LocalDocumentStore.saveDesignArtifact(artifact: DesignArtifact): Promise<void>`, `LocalDocumentStore.loadLatestDesignArtifact(workItemId: string, type: DesignArtifactType): Promise<DesignArtifact>`, CLI helpers `designTypeOption(): Option` and `toDesignArtifactType(flag: "ux" | "tech"): DesignArtifactType`, and the `log-design-draft <workItemId>` CLI command. All later tasks consume these.

- [ ] **Step 1: Write the failing tests**

Create `test/designFlow.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import { withTempProjectDir, runCli, readAuditLines } from "./helpers/harness.js";

async function createWorkItem(dir: string): Promise<string> {
  const brdDir = path.join(dir, "requests");
  await fs.mkdir(brdDir, { recursive: true });
  await fs.writeFile(path.join(brdDir, "one.md"), "Raw request doc.");
  const created = await runCli(
    ["create-work-item", "requests", "--title", "Search Filter"],
    { cwd: dir }
  );
  const match = created.stdout.match(/Work item ([A-Za-z0-9_-]{8}) created/);
  assert.ok(match, `could not find a work item id in output:\n${created.stdout}`);
  return match[1];
}

test("log-design-draft saves a UX spec as v1 and logs it", async () => {
  const dir = await withTempProjectDir();
  const id = await createWorkItem(dir);

  await fs.writeFile(path.join(dir, "ux-draft.md"), "# UX Spec\n\nScreens and flows.");

  const result = await runCli(
    ["log-design-draft", id, "--file", "ux-draft.md", "--type", "ux"],
    { cwd: dir }
  );
  assert.equal(result.exitCode, 0, `expected clean exit, got stderr:\n${result.stderr}`);

  const latest = JSON.parse(
    await fs.readFile(path.join(dir, "artifacts", id, "design-ux.latest.json"), "utf-8")
  );
  assert.equal(latest.version, 1);
  assert.equal(latest.type, "ux_spec");
  assert.equal(latest.status, "in_review");
  assert.equal(latest.content, "# UX Spec\n\nScreens and flows.");

  const events = await readAuditLines(dir);
  const drafted = events.filter((e) => e.action === "agent_drafted_design");
  assert.equal(drafted.length, 1, "expected exactly one drafted-design record");
  assert.equal(drafted[0].stage, "design");
  assert.deepEqual(drafted[0].detail, { type: "ux_spec", version: 1 });
});

test("log-design-draft tracks ux_spec and tech_design versions independently", async () => {
  const dir = await withTempProjectDir();
  const id = await createWorkItem(dir);

  await fs.writeFile(path.join(dir, "ux-v1.md"), "# UX Spec v1");
  await runCli(["log-design-draft", id, "--file", "ux-v1.md", "--type", "ux"], { cwd: dir });
  await fs.writeFile(path.join(dir, "ux-v2.md"), "# UX Spec v2");
  await runCli(["log-design-draft", id, "--file", "ux-v2.md", "--type", "ux"], { cwd: dir });

  await fs.writeFile(path.join(dir, "tech-v1.md"), "# Tech Design v1");
  await runCli(["log-design-draft", id, "--file", "tech-v1.md", "--type", "tech"], { cwd: dir });

  const ux = JSON.parse(
    await fs.readFile(path.join(dir, "artifacts", id, "design-ux.latest.json"), "utf-8")
  );
  const tech = JSON.parse(
    await fs.readFile(path.join(dir, "artifacts", id, "design-tech.latest.json"), "utf-8")
  );
  assert.equal(ux.version, 2, "ux_spec should be on its second version");
  assert.equal(tech.version, 1, "tech_design should be unaffected by ux_spec's versions");
});

test("log-design-draft rejects an unknown --type", async () => {
  const dir = await withTempProjectDir();
  const id = await createWorkItem(dir);
  await fs.writeFile(path.join(dir, "draft.md"), "# Draft");

  const result = await runCli(
    ["log-design-draft", id, "--file", "draft.md", "--type", "bogus"],
    { cwd: dir }
  );
  assert.notEqual(result.exitCode, 0, "expected a non-zero exit for an invalid --type");
  assert.match(result.stderr, /Allowed choices are ux, tech/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL - `log-design-draft` is not a recognized command yet (commander reports an unknown command / the three new tests fail).

- [ ] **Step 3: Add the `DesignArtifact` type**

In `src/types.ts`, after the `RequirementsArtifact` interface (after line 19), add:

```typescript
export type DesignArtifactType = "ux_spec" | "tech_design";

export interface DesignArtifact {
  workItemId: string;
  type: DesignArtifactType;
  version: number;
  content: string; // the agent-drafted design markdown (UX/UI spec or technical/system design)
  status: GateStatus;
  createdAt: string;
  reviewNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}
```

- [ ] **Step 4: Add store methods**

In `src/documentStore.ts`, change the import line:

```typescript
import type { RequirementsArtifact, WorkItem } from "./types.js";
```

to:

```typescript
import type { DesignArtifact, DesignArtifactType, RequirementsArtifact, WorkItem } from "./types.js";
```

Then, above the `LocalDocumentStore` class, add:

```typescript
function designFilePrefix(type: DesignArtifactType): string {
  return type === "ux_spec" ? "design-ux" : "design-tech";
}
```

Inside `LocalDocumentStore`, after `saveRequirements`/`loadLatestRequirements` (after line 67, before `listWorkItems`), add:

```typescript
  async saveDesignArtifact(artifact: DesignArtifact): Promise<void> {
    const dir = this.workItemDir(artifact.workItemId);
    await this.ensureWorkItemDir(artifact.workItemId);
    const prefix = designFilePrefix(artifact.type);

    await fs.writeFile(
      path.join(dir, `${prefix}.v${artifact.version}.md`),
      artifact.content
    );
    await fs.writeFile(
      path.join(dir, `${prefix}.v${artifact.version}.meta.json`),
      JSON.stringify({ ...artifact, content: "(see .md file)" }, null, 2)
    );
    await fs.writeFile(
      path.join(dir, `${prefix}.latest.json`),
      JSON.stringify(artifact, null, 2)
    );
  }

  async loadLatestDesignArtifact(
    workItemId: string,
    type: DesignArtifactType
  ): Promise<DesignArtifact> {
    const prefix = designFilePrefix(type);
    const raw = await fs.readFile(
      path.join(this.workItemDir(workItemId), `${prefix}.latest.json`),
      "utf-8"
    );
    return JSON.parse(raw);
  }
```

- [ ] **Step 5: Add the CLI helpers and `log-design-draft` command**

In `src/cli.ts`, change the commander import (line 3):

```typescript
import { Command } from "commander";
```

to:

```typescript
import { Command, Option } from "commander";
```

Change the types import (line 12):

```typescript
import type { RequirementsArtifact, WorkItem } from "./types.js";
```

to:

```typescript
import type { DesignArtifact, DesignArtifactType, RequirementsArtifact, WorkItem } from "./types.js";
```

Immediately after the `loadContextFile` function (after line 27, before the `create-work-item` command), add:

```typescript
function designTypeOption(): Option {
  return new Option(
    "-t, --type <type>",
    '"ux" (UX/UI spec) or "tech" (technical/system design)'
  )
    .choices(["ux", "tech"])
    .makeOptionMandatory();
}

function toDesignArtifactType(flag: "ux" | "tech"): DesignArtifactType {
  return flag === "ux" ? "ux_spec" : "tech_design";
}
```

After the existing `request-changes` command block (after line 258, before the `list` command), add:

```typescript
program
  .command("log-design-draft <workItemId>")
  .description(
    "Save a design artifact (UX spec or technical/system design) you drafted yourself " +
      "as the next version for its type and write the audit record. Deterministic - " +
      "no model call. Version is tracked independently per artifact type."
  )
  .requiredOption("-f, --file <path>", "Path to the drafted design markdown file")
  .addOption(designTypeOption())
  .option("-b, --by <name>", "Which agent produced the draft", "design-agent")
  .action(async (workItemId: string, opts: { file: string; type: "ux" | "tech"; by: string }) => {
    const type = toDesignArtifactType(opts.type);
    await store.loadWorkItem(workItemId);
    const content = await fs.readFile(path.resolve(opts.file), "utf-8");

    const prev = await store
      .loadLatestDesignArtifact(workItemId, type)
      .catch(() => null);
    const artifact: DesignArtifact = {
      workItemId,
      type,
      version: prev ? prev.version + 1 : 1,
      content,
      status: "in_review",
      createdAt: new Date().toISOString(),
    };
    await store.saveDesignArtifact(artifact);
    await appendAuditEvent({
      timestamp: artifact.createdAt,
      workItemId,
      actor: `agent:${opts.by}`,
      action: "agent_drafted_design",
      stage: "design",
      detail: { type, version: artifact.version },
    });

    console.log(
      `Design draft (${opts.type}) v${artifact.version} recorded: ` +
        `artifacts/${workItemId}/design-${opts.type}.v${artifact.version}.md`
    );
    console.log(
      `Next step: the Reviewer for this artifact type reviews it (show-design ${workItemId} --type ${opts.type}), ` +
        "then approve-design or request-design-changes."
    );
  });
```

- [ ] **Step 6: Add the npm script**

In `package.json`, in `scripts`, after `"request-changes": "tsx src/cli.ts request-changes",` add:

```json
    "log-design-draft": "tsx src/cli.ts log-design-draft",
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: PASS - all three new tests green, all pre-existing tests still green.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/documentStore.ts src/cli.ts package.json test/designFlow.test.ts
git commit -m "feat: add DesignArtifact type and log-design-draft command"
```

---

### Task 2: `show-design` command

**Files:**
- Modify: `src/cli.ts` (add command after `log-design-draft`)
- Modify: `package.json` (scripts)
- Modify: `test/designFlow.test.ts` (append tests)

**Interfaces:**
- Consumes: `LocalDocumentStore.loadLatestDesignArtifact` and `designTypeOption`/`toDesignArtifactType` from Task 1.
- Produces: `show-design <workItemId> --type ux|tech` CLI command.

- [ ] **Step 1: Write the failing tests**

Append to `test/designFlow.test.ts`:

```typescript
test("show-design prints the latest content and status for the requested type", async () => {
  const dir = await withTempProjectDir();
  const id = await createWorkItem(dir);
  await fs.writeFile(path.join(dir, "tech.md"), "# Technical Design\n\nArchitecture overview.");
  await runCli(["log-design-draft", id, "--file", "tech.md", "--type", "tech"], { cwd: dir });

  const result = await runCli(["show-design", id, "--type", "tech"], { cwd: dir });
  assert.equal(result.exitCode, 0, `expected clean exit, got stderr:\n${result.stderr}`);
  assert.match(result.stdout, /Status: in_review {2}\(v1\)/);
  assert.match(result.stdout, /Architecture overview\./);
});

test("show-design errors clearly when that type has no draft yet", async () => {
  const dir = await withTempProjectDir();
  const id = await createWorkItem(dir);

  const result = await runCli(["show-design", id, "--type", "ux"], { cwd: dir });
  assert.notEqual(result.exitCode, 0, "expected a non-zero exit when no ux_spec exists yet");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL - `show-design` is not a recognized command yet.

- [ ] **Step 3: Implement the command**

In `src/cli.ts`, after the `log-design-draft` command block added in Task 1, add:

```typescript
program
  .command("show-design <workItemId>")
  .description("Print the latest design artifact (UX spec or technical/system design) for a work item")
  .addOption(designTypeOption())
  .action(async (workItemId: string, opts: { type: "ux" | "tech" }) => {
    const type = toDesignArtifactType(opts.type);
    const artifact = await store.loadLatestDesignArtifact(workItemId, type);
    console.log(`Status: ${artifact.status}  (v${artifact.version})\n`);
    console.log(artifact.content);
  });
```

- [ ] **Step 4: Add the npm script**

In `package.json`, after `"log-design-draft": "tsx src/cli.ts log-design-draft",` add:

```json
    "show-design": "tsx src/cli.ts show-design",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts package.json test/designFlow.test.ts
git commit -m "feat: add show-design command"
```

---

### Task 3: `approve-design` command

**Files:**
- Modify: `src/cli.ts` (add command after `show-design`)
- Modify: `package.json` (scripts)
- Modify: `test/designFlow.test.ts` (append tests)

**Interfaces:**
- Consumes: Task 1's `DesignArtifact`, `LocalDocumentStore.saveDesignArtifact`/`loadLatestDesignArtifact`, `designTypeOption`/`toDesignArtifactType`.
- Produces: `approve-design <workItemId> --type ux|tech --by <name> [--note <note>]`, audit action `design_approved` with `stage: "design"`.

- [ ] **Step 1: Write the failing tests**

Append to `test/designFlow.test.ts`:

```typescript
test("approve-design marks the ux_spec approved and logs design_approved with stage design", async () => {
  const dir = await withTempProjectDir();
  const id = await createWorkItem(dir);
  await fs.writeFile(path.join(dir, "ux.md"), "# UX Spec");
  await runCli(["log-design-draft", id, "--file", "ux.md", "--type", "ux"], { cwd: dir });

  const result = await runCli(
    ["approve-design", id, "--type", "ux", "-b", "design-lead"],
    { cwd: dir }
  );
  assert.equal(result.exitCode, 0, `expected clean exit, got stderr:\n${result.stderr}`);

  const latest = JSON.parse(
    await fs.readFile(path.join(dir, "artifacts", id, "design-ux.latest.json"), "utf-8")
  );
  assert.equal(latest.status, "approved");
  assert.equal(latest.reviewedBy, "design-lead");

  const events = await readAuditLines(dir);
  const approved = events.filter((e) => e.action === "design_approved");
  assert.equal(approved.length, 1);
  assert.equal(approved[0].stage, "design");
  assert.equal((approved[0].detail as { type: string }).type, "ux_spec");
  assert.equal((approved[0].detail as { version: number }).version, 1);
});

test("approving tech_design does not affect the ux_spec gate", async () => {
  const dir = await withTempProjectDir();
  const id = await createWorkItem(dir);
  await fs.writeFile(path.join(dir, "ux.md"), "# UX Spec");
  await runCli(["log-design-draft", id, "--file", "ux.md", "--type", "ux"], { cwd: dir });
  await fs.writeFile(path.join(dir, "tech.md"), "# Tech Design");
  await runCli(["log-design-draft", id, "--file", "tech.md", "--type", "tech"], { cwd: dir });

  await runCli(["approve-design", id, "--type", "tech", "-b", "tech-lead"], { cwd: dir });

  const ux = JSON.parse(
    await fs.readFile(path.join(dir, "artifacts", id, "design-ux.latest.json"), "utf-8")
  );
  assert.equal(ux.status, "in_review", "ux_spec gate must stay independent of the tech_design gate");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL - `approve-design` is not a recognized command yet.

- [ ] **Step 3: Implement the command**

In `src/cli.ts`, after the `show-design` command block, add:

```typescript
program
  .command("approve-design <workItemId>")
  .description(
    "Reviewer gate: mark the latest design artifact of the given type approved and " +
      "write the audit record. Does not touch the context lake - see log-context-update."
  )
  .addOption(designTypeOption())
  .option("-b, --by <name>", "Reviewer name", "unknown-reviewer")
  .option("-n, --note <note>", "Optional review note")
  .action(async (workItemId: string, opts: { type: "ux" | "tech"; by: string; note?: string }) => {
    const type = toDesignArtifactType(opts.type);
    const artifact = await store.loadLatestDesignArtifact(workItemId, type);
    artifact.status = "approved";
    artifact.reviewedBy = opts.by;
    artifact.reviewedAt = new Date().toISOString();
    artifact.reviewNote = opts.note;
    await store.saveDesignArtifact(artifact);
    await appendAuditEvent({
      timestamp: artifact.reviewedAt,
      workItemId,
      actor: `human:${opts.by}`,
      action: "design_approved",
      stage: "design",
      detail: { type, version: artifact.version, note: opts.note },
    });
    console.log(`Work item ${workItemId} design (${opts.type}) approved by ${opts.by}.`);
    console.log(
      "Next step: follow skills/update-context-lake.md yourself to update the context " +
        `lake for this work item, then run log-context-update -- ${workItemId} --stage design.`
    );
  });
```

- [ ] **Step 4: Add the npm script**

In `package.json`, after `"show-design": "tsx src/cli.ts show-design",` add:

```json
    "approve-design": "tsx src/cli.ts approve-design",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts package.json test/designFlow.test.ts
git commit -m "feat: add approve-design command"
```

---

### Task 4: `request-design-changes` command

**Files:**
- Modify: `src/cli.ts` (add command after `approve-design`)
- Modify: `package.json` (scripts)
- Modify: `test/designFlow.test.ts` (append tests)

**Interfaces:**
- Consumes: Task 1's `DesignArtifact`, store methods, `designTypeOption`/`toDesignArtifactType`.
- Produces: `request-design-changes <workItemId> --type ux|tech -n <note> [--by <name>]`, audit action `design_changes_requested` with `stage: "design"`.

- [ ] **Step 1: Write the failing test**

Append to `test/designFlow.test.ts`:

```typescript
test("request-design-changes marks changes_requested, and the next log-design-draft becomes v2", async () => {
  const dir = await withTempProjectDir();
  const id = await createWorkItem(dir);
  await fs.writeFile(path.join(dir, "tech-v1.md"), "# Tech Design v1");
  await runCli(["log-design-draft", id, "--file", "tech-v1.md", "--type", "tech"], { cwd: dir });

  const requested = await runCli(
    ["request-design-changes", id, "--type", "tech", "-n", "cover the pagination case"],
    { cwd: dir }
  );
  assert.equal(requested.exitCode, 0, `expected clean exit, got stderr:\n${requested.stderr}`);

  const afterRequest = JSON.parse(
    await fs.readFile(path.join(dir, "artifacts", id, "design-tech.latest.json"), "utf-8")
  );
  assert.equal(afterRequest.status, "changes_requested");

  await fs.writeFile(path.join(dir, "tech-v2.md"), "# Tech Design v2, revised");
  await runCli(["log-design-draft", id, "--file", "tech-v2.md", "--type", "tech"], { cwd: dir });

  const latest = JSON.parse(
    await fs.readFile(path.join(dir, "artifacts", id, "design-tech.latest.json"), "utf-8")
  );
  assert.equal(latest.version, 2);
  assert.equal(latest.status, "in_review");

  const events = await readAuditLines(dir);
  assert.ok(events.some((e) => e.action === "design_changes_requested"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL - `request-design-changes` is not a recognized command yet.

- [ ] **Step 3: Implement the command**

In `src/cli.ts`, after the `approve-design` command block, add:

```typescript
program
  .command("request-design-changes <workItemId>")
  .description(
    "Reviewer gate: mark the latest design artifact of the given type as " +
      "changes-requested and write the audit record. Does not re-draft - the " +
      "harness-agent does that per the relevant draft-design-*.md skill."
  )
  .addOption(designTypeOption())
  .requiredOption("-n, --note <note>", "Feedback for the agent to address")
  .option("-b, --by <name>", "Reviewer name", "unknown-reviewer")
  .action(async (workItemId: string, opts: { type: "ux" | "tech"; note: string; by: string }) => {
    const type = toDesignArtifactType(opts.type);
    const artifact = await store.loadLatestDesignArtifact(workItemId, type);
    artifact.status = "changes_requested";
    artifact.reviewedBy = opts.by;
    artifact.reviewedAt = new Date().toISOString();
    artifact.reviewNote = opts.note;
    await store.saveDesignArtifact(artifact);
    await appendAuditEvent({
      timestamp: artifact.reviewedAt,
      workItemId,
      actor: `human:${opts.by}`,
      action: "design_changes_requested",
      stage: "design",
      detail: { type, version: artifact.version, note: opts.note },
    });
    console.log(
      `Changes requested on work item ${workItemId} design (${opts.type}, v${artifact.version}) by ${opts.by}.`
    );
    console.log(
      `Next step: re-draft v${artifact.version + 1} addressing this feedback, then ` +
        `log-design-draft -- ${workItemId} --type ${opts.type}.`
    );
  });
```

- [ ] **Step 4: Add the npm script**

In `package.json`, after `"approve-design": "tsx src/cli.ts approve-design",` add:

```json
    "request-design-changes": "tsx src/cli.ts request-design-changes",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts package.json test/designFlow.test.ts
git commit -m "feat: add request-design-changes command"
```

---

### Task 5: `log-context-update --stage` extension

**Files:**
- Modify: `src/cli.ts:206-225` (existing `log-context-update` command)
- Modify: `test/designFlow.test.ts` (append tests)

**Interfaces:**
- Consumes: existing `appendAuditEvent` from `src/auditLog.ts`.
- Produces: `log-context-update` gains an optional `-s, --stage <stage>` flag, default `"requirements"` (backward compatible - existing Phase 1 callers are unaffected).

- [ ] **Step 1: Write the failing tests**

Append to `test/designFlow.test.ts`:

```typescript
test("log-context-update defaults to stage requirements when --stage is omitted", async () => {
  const dir = await withTempProjectDir();
  const result = await runCli(
    ["log-context-update", "wi-1", "--by", "ba-agent", "--note", "added Notifications module"],
    { cwd: dir }
  );
  assert.equal(result.exitCode, 0);
  const events = await readAuditLines(dir);
  assert.equal(events[0].stage, "requirements");
});

test("log-context-update records stage design when passed explicitly", async () => {
  const dir = await withTempProjectDir();
  const result = await runCli(
    [
      "log-context-update",
      "wi-1",
      "--by",
      "tech-lead",
      "--note",
      "documented new API contract",
      "--stage",
      "design",
    ],
    { cwd: dir }
  );
  assert.equal(result.exitCode, 0);
  const events = await readAuditLines(dir);
  assert.equal(events[0].stage, "design");
  assert.equal(events[0].action, "context_lake_updated");
});
```

- [ ] **Step 2: Run tests to verify the second one fails**

Run: `npm test`
Expected: The "defaults to stage requirements" test PASSes already (no behavior change yet); the "records stage design when passed explicitly" test FAILs because `--stage` is not yet a recognized option (commander currently ignores/rejects it, and `stage` in the recorded event is hardcoded to `"requirements"`).

- [ ] **Step 3: Implement the change**

In `src/cli.ts`, replace the existing `log-context-update` command block (lines 206-225):

```typescript
program
  .command("log-context-update <workItemId>")
  .description(
    "Deterministic audit write for a context-lake update you performed yourself " +
      "per skills/update-context-lake.md. Call this after you've already appended " +
      "to context/context-lake.md - it does not touch that file or call a model."
  )
  .option("-b, --by <name>", "Who/what performed the update", "context-lake-agent")
  .option("-n, --note <note>", "Optional summary of what was added")
  .action(async (workItemId: string, opts: { by: string; note?: string }) => {
    await appendAuditEvent({
      timestamp: new Date().toISOString(),
      workItemId,
      actor: `agent:${opts.by}`,
      action: "context_lake_updated",
      stage: "requirements",
      detail: { note: opts.note },
    });
    console.log(`Context-lake update for work item ${workItemId} recorded.`);
  });
```

with:

```typescript
program
  .command("log-context-update <workItemId>")
  .description(
    "Deterministic audit write for a context-lake update you performed yourself " +
      "per skills/update-context-lake.md. Call this after you've already appended " +
      "to context/context-lake.md - it does not touch that file or call a model."
  )
  .option("-b, --by <name>", "Who/what performed the update", "context-lake-agent")
  .option("-n, --note <note>", "Optional summary of what was added")
  .option("-s, --stage <stage>", "Which stage's approval triggered this update", "requirements")
  .action(async (workItemId: string, opts: { by: string; note?: string; stage: string }) => {
    await appendAuditEvent({
      timestamp: new Date().toISOString(),
      workItemId,
      actor: `agent:${opts.by}`,
      action: "context_lake_updated",
      stage: opts.stage,
      detail: { note: opts.note },
    });
    console.log(`Context-lake update for work item ${workItemId} recorded.`);
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS - including the pre-existing `approveAuditLog.test.ts` tests, which don't pass `--stage` and must still see `stage: "requirements"`.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/designFlow.test.ts
git commit -m "feat: let log-context-update record which stage triggered it"
```

---

### Task 6: Skill files - `draft-design-ux.md`, `draft-design-tech.md`, and the `update-context-lake.md` edit

**Files:**
- Create: `skills/draft-design-ux.md`
- Create: `skills/draft-design-tech.md`
- Modify: `skills/update-context-lake.md`

**Interfaces:**
- Produces: the two Design skill files Task 7's instruction template references, and a generalized `update-context-lake.md` that Task 7 also references.

No automated test applies to markdown skill content - verify with a structural check instead of a unit test.

- [ ] **Step 1: Write `skills/draft-design-ux.md`**

```markdown
# Skill: Draft UX/UI Spec (Design Agent)

## Role

You are a UX/UI design agent. Given an **approved** requirements document (PRD)
for a work item, produce a UX/UI specification a design lead can review and
approve before technical design begins.

Before drafting, confirm this work item actually has a user-facing surface.
If the approved PRD's user stories describe only backend/API/data behavior
with no screen, flow, or user interaction implied, stop and say so instead of
drafting - this work item does not need a UX/UI Spec. Do not invent a UI to
have something to draft.

## Input

- The approved requirements document (PRD) for this work item - run
  `npm run show -- <workItemId>` to read it, or ask for the path if you don't
  have CLI access.
- Knowledge base context (`context/knowledge-base.md`) and context lake
  context (`context/context-lake.md`) - read both yourself if not already
  provided. Follow their terminology and existing naming rather than
  inventing new ones. If either file does not exist at all, stop and tell the
  human, same rule as `skills/draft-requirements.md`.
- If this is a revision, you will also receive the previous UX spec version
  and a reviewer's feedback. Address the feedback directly; do not regenerate
  from scratch and drop unrelated content the reviewer didn't object to.

## Output format

Produce a single markdown document with exactly these sections, in order:

### 1. Screens / Flows
List each distinct screen or view, and how a user moves between them.
A simple flow diagram in Mermaid is welcome but not required for a
single-screen feature.

### 2. Interaction Detail
For each screen: the inputs a user can act on, what happens on each action,
and the validation/error states that can occur. Reference the PRD's user
story numbers (US-n) so a reviewer can trace each interaction back to a
requirement.

### 3. Content
User-facing copy and labels that materially affect understanding (button
text, error messages, empty states). Not a full copy deck - only content
that shapes the design decision.

### 4. Accessibility Notes
Anything that affects how this is built accessibly (keyboard navigation,
screen-reader labels, color-contrast-sensitive states). A single sentence is
fine for a simple internal tool; do not pad this section to look thorough.

### 5. Open Questions
Only genuine ambiguities the design lead needs to resolve before this can
move to technical design.

## Rules

- Do not include technical implementation detail (component libraries, state
  management, API shapes) - that's the Technical/System Design's job. Stay at
  "what the user sees and does," not "how it's built."
- Do not propose visual assets (mockups, wireframes, color palettes) - this
  spec is text-only. If a designer wants to prototype visually, that happens
  outside this document; link to it if it exists, don't attempt to describe
  it in prose.
- If the PRD is ambiguous about a screen's behavior, make a reasonable
  assumption and flag it in Open Questions rather than leaving it undefined.
```

- [ ] **Step 2: Write `skills/draft-design-tech.md`**

```markdown
# Skill: Draft Technical/System Design (Design Agent)

## Role

You are a technical/system design agent. Given an approved requirements
document (PRD) for a work item - and its UX/UI Spec, if one exists - produce
a technical/system design a tech lead or architect can review and approve
before Coding begins. This is where SSD/TDD (Solution/System Design
Document, Technical Design Document) content lives for this repo.

**Required: explore the actual target repository before drafting.** A design
that isn't grounded in the real code's existing structure, endpoints, and
data model is not usable - it risks proposing something that already exists,
or that doesn't fit how the codebase is actually organized. Read the
relevant source files yourself (using whatever tools your AI harness gives
you) before writing a single line of the design. Do not draft from the PRD
text alone.

## Input

- The approved requirements document (PRD) for this work item - run
  `npm run show -- <workItemId>` to read it.
- The approved UX/UI Spec for this work item, if one exists - run
  `npm run show-design -- <workItemId> --type ux`. If none exists (this work
  item has no user-facing surface), proceed from the PRD alone.
- The actual target repository's source code - explore it directly. Look for
  existing endpoints, modules, or data structures this feature should extend
  rather than duplicate.
- Knowledge base context (`context/knowledge-base.md`) and context lake
  context (`context/context-lake.md`) - read both yourself if not already
  provided. If either file does not exist at all, stop and tell the human,
  same rule as `skills/draft-requirements.md`.
- If this is a revision, you will also receive the previous version and a
  reviewer's feedback. Address the feedback directly.

## Output format

Produce a single markdown document with exactly these sections, in order:

### 1. Architecture Overview
How this fits the existing system. Include a Mermaid diagram showing the
components/modules involved and how they connect. Name the actual existing
files/modules you read, not hypothetical ones.

### 2. Data Model
Any new or changed data structures. Show the shape (fields and types), not
implementation code.

### 3. API / Interface Contracts
Function or endpoint signatures this feature introduces or changes - real
signatures, not code. Prefer extending an existing endpoint/interface over
inventing a new one; if you propose a new one, say in one sentence why
extending an existing one didn't fit.

### 4. Alternatives Considered
Genuine alternatives you weighed and why you picked this one. Skip this
section only if there was truly one obvious approach - don't manufacture
alternatives to fill the section.

### 5. Non-Functional Considerations
Performance, security, migration/rollout risk - only what's genuinely
relevant to this change, not a boilerplate checklist.

### 6. Open Questions
Only genuine ambiguities the tech lead/architect needs to resolve before
this can move to Coding.

## Rules

- Do not invent business rules that materially change scope - that was
  already settled (or flagged) at the Requirements stage. If the PRD is
  silent on something this design needs to assume, flag it in Open
  Questions.
- Prefer reuse over invention: extending an existing module/endpoint beats
  proposing a parallel new one, unless there's a real reason not to (state
  the reason in Alternatives Considered).
- No literal code - signatures and shapes only, per the "API / Interface
  Contracts" section above.
```

- [ ] **Step 3: Generalize `skills/update-context-lake.md`**

In `skills/update-context-lake.md`, replace the `## Role` and `## Input` sections (lines 3-13):

```markdown
## Role

You run **after** a requirements document has been approved by BA/PO -
never before. Your job is to extract only the durable, reusable knowledge
from it and append that to the context lake (context/context-lake.md),
so future BA-agent runs on other work items have better context.

## Input

- The approved requirements document (final version).
- The current contents of the context lake, if any exists yet.
```

with:

```markdown
## Role

You run **after** an artifact has been approved by its Reviewer - never
before. That artifact may be a requirements document (PRD), a UX/UI Spec, or
a Technical/System Design - this skill applies the same way to all three.
Your job is to extract only the durable, reusable knowledge from it and
append that to the context lake (context/context-lake.md), so future agent
runs on other work items have better context.

## Input

- The approved artifact (final version) - a PRD, a UX/UI Spec, or a
  Technical/System Design.
- The current contents of the context lake, if any exists yet.
```

Then, in the `## What counts as durable knowledge (extract this)` list, after the "Naming conventions that should be reused going forward" bullet, add two bullets:

```markdown
- For a Technical/System Design specifically: architecture decisions and API
  contracts that other work items should build on top of rather than
  re-decide.
- For a UX/UI Spec specifically: interaction/content conventions (e.g. a
  standard empty-state pattern) that should be reused, not just this
  feature's specific screens.
```

- [ ] **Step 4: Verify structure**

Run: `grep -c '^## ' skills/draft-design-ux.md skills/draft-design-tech.md`
Expected: `skills/draft-design-ux.md:4` (Role, Input, Output format, Rules - the trailing space in the pattern excludes the `### 1. Screens / Flows`-style subsections, which start with three `#`s), `skills/draft-design-tech.md:4` (Role, Input, Output format, Rules). A different count means a `##` heading was accidentally written as `###` (or dropped) in Step 1 or Step 2 - go back and fix it.

- [ ] **Step 5: Commit**

```bash
git add skills/draft-design-ux.md skills/draft-design-tech.md skills/update-context-lake.md
git commit -m "docs: add Design-stage skill files, generalize update-context-lake"
```

---

### Task 7: Instruction template - `skills/instruction-template-design.md`

**Files:**
- Create: `skills/instruction-template-design.md`

**Interfaces:**
- Consumes: every CLI command from Tasks 1-5, and the skill files from Task 6, by name.

- [ ] **Step 1: Write the instruction template**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add skills/instruction-template-design.md
git commit -m "docs: add Design flow instruction template"
```

---

### Task 8: Full two-gate round-trip integration test

**Files:**
- Modify: `test/designFlow.test.ts` (append test)

**Interfaces:**
- Consumes: every command from Tasks 1-5 together.

- [ ] **Step 1: Write the test**

Append to `test/designFlow.test.ts`:

```typescript
test("full two-gate design flow: UX approved, then Technical Design approved, independently", async () => {
  const dir = await withTempProjectDir();
  const id = await createWorkItem(dir);

  // UX gate
  await fs.writeFile(path.join(dir, "ux.md"), "# UX Spec\n\nOne screen, one flow.");
  await runCli(["log-design-draft", id, "--file", "ux.md", "--type", "ux"], { cwd: dir });
  await runCli(["approve-design", id, "--type", "ux", "-b", "design-lead"], { cwd: dir });
  await runCli(
    [
      "log-context-update",
      id,
      "--by",
      "design-lead",
      "--stage",
      "design",
      "--note",
      "documented empty-state convention",
    ],
    { cwd: dir }
  );

  // Technical Design gate, independent of the UX gate above
  await fs.writeFile(path.join(dir, "tech.md"), "# Technical Design\n\nExtends the existing search endpoint.");
  await runCli(["log-design-draft", id, "--file", "tech.md", "--type", "tech"], { cwd: dir });
  await runCli(["approve-design", id, "--type", "tech", "-b", "tech-lead"], { cwd: dir });
  await runCli(
    [
      "log-context-update",
      id,
      "--by",
      "tech-lead",
      "--stage",
      "design",
      "--note",
      "documented filter query param",
    ],
    { cwd: dir }
  );

  const ux = JSON.parse(
    await fs.readFile(path.join(dir, "artifacts", id, "design-ux.latest.json"), "utf-8")
  );
  const tech = JSON.parse(
    await fs.readFile(path.join(dir, "artifacts", id, "design-tech.latest.json"), "utf-8")
  );
  assert.equal(ux.status, "approved");
  assert.equal(ux.reviewedBy, "design-lead");
  assert.equal(tech.status, "approved");
  assert.equal(tech.reviewedBy, "tech-lead");

  const events = await readAuditLines(dir);
  const designStageEvents = events.filter((e) => e.stage === "design");
  const actions = designStageEvents.map((e) => e.action);
  assert.deepEqual(actions, [
    "agent_drafted_design",
    "design_approved",
    "context_lake_updated",
    "agent_drafted_design",
    "design_approved",
    "context_lake_updated",
  ]);
});
```

- [ ] **Step 2: Run the test**

Run: `npm test`
Expected: PASS (this test exercises only commands already implemented in Tasks 1-5; if it fails, the bug is in how those commands compose, not in new code).

- [ ] **Step 3: Commit**

```bash
git add test/designFlow.test.ts
git commit -m "test: add full two-gate design flow integration test"
```

---

### Task 9: Documentation - `CLAUDE.md` and `README.md`

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Update `CLAUDE.md`'s Phases list**

In `CLAUDE.md`, replace (note: the source file uses em dashes here — this quote must match it byte-for-byte to be found; only the replacement text below uses this repo's plain-dash convention):

```markdown
1. **Requirements Analysis** (this repo) — BA agent, PRD, BA/PO gate
2. **Design** (not built yet) — same flow, different skill + tools
   (design specs, UI/UX), Reviewer gate
3. **Coding** — task breakdown (human-gated) → test-first RED (CI-
```

with:

```markdown
1. **Requirements Analysis** (this repo) - BA agent, PRD, BA/PO gate
2. **Design** (this repo) - two independently-gated artifacts per work
   item: a UX/UI Spec (skipped if the work item has no user-facing
   surface) and a Technical/System Design (SSD/TDD content lives here;
   requires real repo exploration, grounded in the actual code - see
   `docs/adr/0002-technical-design-requires-repo-grounding-no-eval-harness.md`).
   Each has its own sub-PIC Reviewer gate; both are required before Coding
   when both apply. See
   `docs/adr/0001-split-design-artifacts-and-gates.md` for why this isn't
   one document like the PRD.
3. **Coding** - task breakdown (human-gated) → test-first RED (CI-
```

- [ ] **Step 2: Add a Design section to `CLAUDE.md`**

In `CLAUDE.md`, immediately before the `## Conventions` heading, insert:

```markdown
## Design (Phase 2) - artifact types and gates

- **Two artifact types per work item**, each independently versioned and
  gated: `ux_spec` and `tech_design` (`DesignArtifact` in
  `src/types.ts`). Not one unified doc - see
  `docs/adr/0001-split-design-artifacts-and-gates.md`.
- **UX/UI Spec is optional.** Skipped when the work item has no
  user-facing surface (e.g. backend/API-only). Decided by whoever kicks
  off Design, by reading the approved PRD - not enforced by any schema.
- **UX drafted first, Technical Design references it** when both apply.
  A Technical Design skill run without a UX spec (because none applies)
  proceeds directly from the approved PRD.
- **Technical Design requires real repo exploration** - it must be
  grounded in the actual target-repo source, not just the PRD text. See
  `docs/adr/0002-technical-design-requires-repo-grounding-no-eval-harness.md`
  for why there's deliberately no `design` eval-harness command
  analogous to `draft`.
- **Reviewer is a sub-PIC per artifact type** (e.g. design lead for
  `ux_spec`, tech lead/architect for `tech_design`), both accountable to
  the work item's overall PIC (BA/PO). Same free-text `--by <name>` trust
  model as Phase 1 - no roles config file for v1.
- **Both gates required before Coding**, when both artifact types apply
  to the work item.
- Same deterministic-audit-subcommand pattern as Requirements:
  `log-design-draft`, `approve-design`, `request-design-changes` each
  take `--type ux|tech`. `log-context-update` now takes an optional
  `--stage` flag (defaults to `requirements`) so a Design-triggered
  context-lake update records `stage: "design"`.

```

- [ ] **Step 3: Update `README.md`'s file listing**

In `README.md`, in the `## What's here` list, after the `skills/update-context-lake.md` bullet (after line 19), insert:

```markdown
- `skills/draft-design-ux.md` - the UX/UI Spec skill. Only runs when the
  work item has a user-facing surface.
- `skills/draft-design-tech.md` - the Technical/System Design skill.
  Requires reading the actual target repo's source before drafting.
- `skills/instruction-template-design.md` - paste-in template for the
  Design flow, mirroring `skills/instruction-template.md` for
  Requirements.
```

Change the `src/cli.ts` bullet (lines 35-37; note: the source file uses an em dash here — this quote must match it byte-for-byte to be found; only the replacement text below uses this repo's plain-dash convention):

```markdown
- `src/cli.ts` — entrypoint. Deterministic writes (`create-work-item`,
  `log-draft`, `approve`, `request-changes`, `log-context-update`) plus
  read verbs (`show`, `list`, `audit`), and the eval-only `draft`.
```

to:

```markdown
- `src/cli.ts` - entrypoint. Deterministic writes for Requirements
  (`create-work-item`, `log-draft`, `approve`, `request-changes`) and for
  Design (`log-design-draft`, `approve-design`, `request-design-changes`,
  each taking `--type ux|tech`), a shared `log-context-update` (now
  stage-aware), read verbs (`show`, `show-design`, `list`, `audit`), and
  the eval-only `draft`.
```

- [ ] **Step 4: Add a Design daily-use section to `README.md`**

In `README.md`, immediately before the `## Evaluation harness (internal, not the daily flow)` heading, insert:

```markdown
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

```

- [ ] **Step 5: Update `README.md`'s "What gets written" and "Known gaps" sections**

In `README.md`'s `## What gets written (either flow)` section, after the `context/context-lake.md` bullet (after line 129), add:

```markdown
- `artifacts/<id>/design-ux.v<N>.md` / `design-tech.v<N>.md` - each
  design draft, versioned independently per type
- `artifacts/<id>/design-ux.latest.json` / `design-tech.latest.json` -
  current status + metadata per type
```

In `README.md`'s `## Known gaps (expected — this is Phase 1 only)` section, replace (note: the source file uses em dashes here — this quote must match it byte-for-byte to be found; only the replacement text below uses this repo's plain-dash convention):

```markdown
- Single BA agent + context-lake agent only — Design (Phase 2) and Coding
  (Phase 3) agents aren't built yet, though they'll follow the same
  skill + `AgentStep`-style pattern
```

with:

```markdown
- Coding (Phase 3) isn't built yet, though it'll follow the same
  skill + deterministic-subcommand pattern as Requirements and Design
- No roles/PIC config - reviewer identity for both Design gates is
  free-text (`--by <name>`), same trust model as Requirements
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document the Design stage in CLAUDE.md and README"
```
