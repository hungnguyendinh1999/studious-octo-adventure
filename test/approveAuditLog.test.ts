import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  withTempProjectDir,
  seedInReviewWorkItem,
  runCli,
  readAuditLines,
} from "./helpers/harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, "..", "src");

test("approve writes exactly one ba_approved_requirements audit record and does not touch the context lake", async () => {
  const dir = await withTempProjectDir();
  await seedInReviewWorkItem(dir, {
    id: "wi-test-1",
    title: "Test work item",
    content: "# Requirements\n\nSome content.",
  });

  // No Ollama stub needed: approve no longer calls a model at all.
  const result = await runCli(["approve", "wi-test-1", "-b", "reviewer"], {
    cwd: dir,
  });

  assert.equal(result.exitCode, 0, `expected clean exit, got stderr:\n${result.stderr}`);
  assert.match(
    result.stdout,
    /Next step: follow skills\/update-context-lake\.md yourself to update the context lake for this work item\./,
    "expected approve to print the next-step instruction"
  );

  const events = await readAuditLines(dir);
  const approvals = events.filter((e) => e.action === "ba_approved_requirements");
  assert.equal(approvals.length, 1, "expected exactly one approval audit record");

  const [event] = approvals;
  assert.equal(event.workItemId, "wi-test-1");
  assert.equal(event.actor, "human:reviewer");
  assert.equal(event.stage, "requirements");
  assert.equal((event.detail as { version: number }).version, 1);

  assert.ok(
    !events.some((e) => e.action === "context_lake_updated"),
    "approve must no longer write a context_lake_updated audit record itself"
  );
});

test("log-context-update writes exactly one context_lake_updated audit record", async () => {
  const dir = await withTempProjectDir();

  const result = await runCli(
    ["log-context-update", "wi-test-1", "-b", "reviewer", "-n", "added Task Management term"],
    { cwd: dir }
  );

  assert.equal(result.exitCode, 0, `expected clean exit, got stderr:\n${result.stderr}`);

  const events = await readAuditLines(dir);
  const updates = events.filter((e) => e.action === "context_lake_updated");
  assert.equal(updates.length, 1, "expected exactly one context-lake-update audit record");

  const [event] = updates;
  assert.equal(event.workItemId, "wi-test-1");
  assert.equal(event.actor, "agent:reviewer");
  assert.equal(event.stage, "requirements");
  assert.equal(
    (event.detail as { note?: string }).note,
    "added Task Management term"
  );
});

test("the context-lake-update audit action is only ever assigned in one place in src/, inside the log-context-update command", async () => {
  const files = (await fs.readdir(SRC_DIR)).filter((f) => f.endsWith(".ts"));
  const actionAssignment = /action:\s*"context_lake_updated"/g;
  let totalOccurrences = 0;
  let cliSource = "";

  for (const file of files) {
    const content = await fs.readFile(path.join(SRC_DIR, file), "utf-8");
    const matches = content.match(actionAssignment) ?? [];
    totalOccurrences += matches.length;
    if (file === "cli.ts") cliSource = content;
  }

  assert.equal(
    totalOccurrences,
    1,
    "expected the context-lake-update audit action to be assigned in exactly one place across src/"
  );

  const blockStart = cliSource.indexOf('.command("log-context-update');
  assert.notEqual(blockStart, -1, "log-context-update command block not found in cli.ts");
  const nextCommandStart = cliSource.indexOf('program\n  .command(', blockStart + 1);
  const block = cliSource.slice(
    blockStart,
    nextCommandStart === -1 ? undefined : nextCommandStart
  );

  assert.ok(
    block.includes("context_lake_updated"),
    "the context-lake-update audit action string must live inside the log-context-update command block"
  );
});

test("the approval audit action string is only ever assigned as an AuditEvent action in one place in src/, inside the approve command", async () => {
  const files = (await fs.readdir(SRC_DIR)).filter((f) => f.endsWith(".ts"));
  // Matches an actual `action: "ba_approved_requirements"` field assignment
  // (a real AuditEvent literal), not mentions in comments/docs/type unions.
  const actionAssignment = /action:\s*"ba_approved_requirements"/g;
  let totalOccurrences = 0;
  let cliSource = "";

  for (const file of files) {
    const content = await fs.readFile(path.join(SRC_DIR, file), "utf-8");
    const matches = content.match(actionAssignment) ?? [];
    totalOccurrences += matches.length;
    if (file === "cli.ts") cliSource = content;
  }

  assert.equal(
    totalOccurrences,
    1,
    "expected the approval audit action to be assigned in exactly one place across src/"
  );

  const approveBlockStart = cliSource.indexOf('.command("approve');
  assert.notEqual(approveBlockStart, -1, "approve command block not found in cli.ts");
  const nextCommandStart = cliSource.indexOf(
    'program\n  .command(',
    approveBlockStart + 1
  );
  const approveBlock = cliSource.slice(
    approveBlockStart,
    nextCommandStart === -1 ? undefined : nextCommandStart
  );

  assert.ok(
    approveBlock.includes("ba_approved_requirements"),
    "the approval audit action string must live inside the approve command block"
  );
});

test("request-changes writes ba_requested_changes, marks the artifact changes_requested, and re-drafts nothing itself", async () => {
  const dir = await withTempProjectDir();
  await seedInReviewWorkItem(dir, {
    id: "wi-test-2",
    title: "Test work item",
    content: "# Requirements\n\nSome content.",
  });

  // No Ollama stub: request-changes no longer calls a model either.
  const result = await runCli(
    ["request-changes", "wi-test-2", "-n", "please clarify scope", "-b", "reviewer"],
    { cwd: dir }
  );

  assert.equal(result.exitCode, 0, `expected clean exit, got stderr:\n${result.stderr}`);
  assert.match(
    result.stdout,
    /Next step: follow skills\/draft-requirements\.md yourself to re-draft/,
    "expected request-changes to print the next-step instruction"
  );

  const events = await readAuditLines(dir);
  const requested = events.filter((e) => e.action === "ba_requested_changes");
  assert.equal(requested.length, 1, "expected exactly one changes-requested audit record");
  assert.equal(requested[0].actor, "human:reviewer");
  assert.equal(
    (requested[0].detail as { note: string }).note,
    "please clarify scope"
  );

  assert.ok(
    !events.some((e) => e.action === "ba_approved_requirements"),
    "request-changes must never write an approval audit record"
  );
  assert.ok(
    !events.some((e) => e.action === "agent_drafted_requirements"),
    "request-changes must not claim a draft it did not produce"
  );

  const latest = JSON.parse(
    await fs.readFile(
      path.join(dir, "artifacts", "wi-test-2", "requirements.latest.json"),
      "utf-8"
    )
  );
  assert.equal(latest.status, "changes_requested");
  assert.equal(latest.version, 1, "request-changes must not bump the version itself");
});
