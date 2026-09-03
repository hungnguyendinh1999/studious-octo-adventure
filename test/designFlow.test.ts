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
