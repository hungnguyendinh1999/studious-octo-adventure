import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import {
  withTempProjectDir,
  runCli,
  readAuditLines,
} from "./helpers/harness.js";

async function seedBrdFolder(dir: string): Promise<string> {
  const brdDir = path.join(dir, "requests");
  await fs.mkdir(brdDir, { recursive: true });
  await fs.writeFile(path.join(brdDir, "one.md"), "First raw request doc.");
  await fs.writeFile(path.join(brdDir, "two.md"), "Second raw request doc.");
  return brdDir;
}

function parseWorkItemId(stdout: string): string {
  const match = stdout.match(/Work item ([A-Za-z0-9_-]{8}) created/);
  assert.ok(match, `could not find a work item id in output:\n${stdout}`);
  return match[1];
}

test("create-work-item mints a work item from a BRD folder and logs it, without calling a model", async () => {
  const dir = await withTempProjectDir();
  await seedBrdFolder(dir);

  const result = await runCli(
    ["create-work-item", "requests", "--title", "Todo App"],
    { cwd: dir }
  );

  assert.equal(result.exitCode, 0, `expected clean exit, got stderr:\n${result.stderr}`);
  const id = parseWorkItemId(result.stdout);

  const workItem = JSON.parse(
    await fs.readFile(path.join(dir, "artifacts", id, "work-item.json"), "utf-8")
  );
  assert.equal(workItem.title, "Todo App");
  assert.match(workItem.rawRequest, /First raw request doc\./);
  assert.match(workItem.rawRequest, /Second raw request doc\./);

  const events = await readAuditLines(dir);
  const created = events.filter((e) => e.action === "work_item_created");
  assert.equal(created.length, 1, "expected exactly one work_item_created record");
  assert.equal(created[0].workItemId, id);
  assert.deepEqual((created[0].detail as { inputFiles: string[] }).inputFiles, [
    "one.md",
    "two.md",
  ]);

  assert.ok(
    !events.some((e) => e.action === "agent_drafted_requirements"),
    "create-work-item must not claim a draft it did not produce"
  );
});

test("log-draft saves a version and logs it, and approve works on the result", async () => {
  const dir = await withTempProjectDir();
  await seedBrdFolder(dir);

  const created = await runCli(
    ["create-work-item", "requests", "--title", "Todo App"],
    { cwd: dir }
  );
  const id = parseWorkItemId(created.stdout);

  // The harness-agent writes its drafted PRD somewhere, then hands it over.
  const draftPath = path.join(dir, "drafted-prd.md");
  await fs.writeFile(draftPath, "# PRD\n\nDrafted by the harness-agent.");

  const logged = await runCli(["log-draft", id, "--file", "drafted-prd.md"], {
    cwd: dir,
  });
  assert.equal(logged.exitCode, 0, `expected clean exit, got stderr:\n${logged.stderr}`);

  const latest = JSON.parse(
    await fs.readFile(
      path.join(dir, "artifacts", id, "requirements.latest.json"),
      "utf-8"
    )
  );
  assert.equal(latest.version, 1);
  assert.equal(latest.status, "in_review");
  assert.equal(latest.content, "# PRD\n\nDrafted by the harness-agent.");

  const events = await readAuditLines(dir);
  const drafted = events.filter((e) => e.action === "agent_drafted_requirements");
  assert.equal(drafted.length, 1, "expected exactly one drafted record");
  assert.equal((drafted[0].detail as { version: number }).version, 1);

  // The whole point: approve must now work end-to-end on a harness-drafted PRD.
  const approved = await runCli([...["approve", id], "--by", "jane.ba"], {
    cwd: dir,
  });
  assert.equal(
    approved.exitCode,
    0,
    `approve should succeed after log-draft, got stderr:\n${approved.stderr}`
  );
  const afterApprove = await readAuditLines(dir);
  assert.ok(
    afterApprove.some((e) => e.action === "ba_approved_requirements"),
    "expected the approval to be recorded"
  );
});

test("log-draft auto-increments the version on a re-draft", async () => {
  const dir = await withTempProjectDir();
  await seedBrdFolder(dir);

  const created = await runCli(
    ["create-work-item", "requests", "--title", "Todo App"],
    { cwd: dir }
  );
  const id = parseWorkItemId(created.stdout);

  await fs.writeFile(path.join(dir, "v1.md"), "# PRD v1");
  await runCli(["log-draft", id, "--file", "v1.md"], { cwd: dir });

  await runCli([...["request-changes", id], "-n", "split the due-date story"], {
    cwd: dir,
  });

  await fs.writeFile(path.join(dir, "v2.md"), "# PRD v2, revised");
  const second = await runCli(["log-draft", id, "--file", "v2.md"], { cwd: dir });
  assert.equal(second.exitCode, 0, `expected clean exit, got stderr:\n${second.stderr}`);

  const latest = JSON.parse(
    await fs.readFile(
      path.join(dir, "artifacts", id, "requirements.latest.json"),
      "utf-8"
    )
  );
  assert.equal(latest.version, 2, "expected the re-draft to become v2");
  assert.equal(latest.status, "in_review", "a re-draft goes back into review");
  assert.equal(latest.content, "# PRD v2, revised");

  // Both versions stay on disk - every draft is inspectable later.
  await fs.access(path.join(dir, "artifacts", id, "requirements.v1.md"));
  await fs.access(path.join(dir, "artifacts", id, "requirements.v2.md"));
});
