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
