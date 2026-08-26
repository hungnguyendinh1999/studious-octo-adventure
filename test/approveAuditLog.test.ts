import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  withTempProjectDir,
  seedInReviewWorkItem,
  startStubOllama,
  runCli,
  readAuditLines,
} from "./helpers/harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, "..", "src");

test("approve writes exactly one ba_approved_requirements audit record", async () => {
  const dir = await withTempProjectDir();
  await seedInReviewWorkItem(dir, {
    id: "wi-test-1",
    title: "Test work item",
    content: "# Requirements\n\nSome content.",
  });
  const stub = await startStubOllama();

  try {
    const result = await runCli(["approve", "wi-test-1", "-b", "reviewer"], {
      cwd: dir,
      ollamaBaseUrl: stub.url,
    });

    assert.equal(result.exitCode, 0, `expected clean exit, got stderr:\n${result.stderr}`);

    const events = await readAuditLines(dir);
    const approvals = events.filter((e) => e.action === "ba_approved_requirements");
    assert.equal(approvals.length, 1, "expected exactly one approval audit record");

    const [event] = approvals;
    assert.equal(event.workItemId, "wi-test-1");
    assert.equal(event.actor, "human:reviewer");
    assert.equal(event.stage, "requirements");
    assert.equal((event.detail as { version: number }).version, 1);
  } finally {
    await stub.close();
  }
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

test("request-changes writes ba_requested_changes, never ba_approved_requirements", async () => {
  const dir = await withTempProjectDir();
  await seedInReviewWorkItem(dir, {
    id: "wi-test-2",
    title: "Test work item",
    content: "# Requirements\n\nSome content.",
  });
  const stub = await startStubOllama();

  try {
    const result = await runCli(
      ["request-changes", "wi-test-2", "-n", "please clarify scope"],
      { cwd: dir, ollamaBaseUrl: stub.url }
    );

    assert.equal(result.exitCode, 0, `expected clean exit, got stderr:\n${result.stderr}`);

    const events = await readAuditLines(dir);
    assert.ok(
      events.some((e) => e.action === "ba_requested_changes"),
      "expected a ba_requested_changes audit record"
    );
    assert.ok(
      !events.some((e) => e.action === "ba_approved_requirements"),
      "request-changes must never write an approval audit record"
    );
  } finally {
    await stub.close();
  }
});
