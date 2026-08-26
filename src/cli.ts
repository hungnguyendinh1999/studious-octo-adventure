#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { nanoid } from "nanoid";
import { promises as fs } from "fs";
import path from "path";
import { LocalDocumentStore } from "./documentStore.js";
import { appendAuditEvent, readAuditLog } from "./auditLog.js";
import { draftRequirements, type LabeledDoc } from "./baAgent.js";
import { OllamaModelClient } from "./modelClient.js";
import type { RequirementsArtifact, WorkItem } from "./types.js";

const store = new LocalDocumentStore();
const program = new Command();
const CONTEXT_DIR = path.resolve(process.cwd(), "context");
const KNOWLEDGE_BASE_PATH = path.join(CONTEXT_DIR, "knowledge-base.md");
const CONTEXT_LAKE_PATH = path.join(CONTEXT_DIR, "context-lake.md");

async function loadInputDocs(files: string[]): Promise<LabeledDoc[]> {
  return Promise.all(
    files.map(async (f) => ({
      filename: path.basename(f),
      content: await fs.readFile(path.resolve(f), "utf-8"),
    }))
  );
}

async function loadContextFile(filePath: string): Promise<LabeledDoc[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return [{ filename: path.basename(filePath), content }];
  } catch {
    return [];
  }
}

program
  .command("draft <files...>")
  .description(
    "Run the BA agent on one or more raw input documents (BRD, notes, etc.); creates a WorkItem + requirements draft"
  )
  .option("-t, --title <title>", "Short title for the work item", "Untitled")
  .action(async (files: string[], opts: { title: string }) => {
    const modelClient = new OllamaModelClient();
    const inputDocs = await loadInputDocs(files);
    const knowledgeBaseDocs = await loadContextFile(KNOWLEDGE_BASE_PATH);
    const contextLakeDocs = await loadContextFile(CONTEXT_LAKE_PATH);

    const workItem: WorkItem = {
      id: nanoid(8),
      title: opts.title,
      rawRequest: inputDocs.map((d) => `--- ${d.filename} ---\n${d.content}`).join("\n\n"),
      createdAt: new Date().toISOString(),
    };
    await store.saveWorkItem(workItem);
    await appendAuditEvent({
      timestamp: workItem.createdAt,
      workItemId: workItem.id,
      actor: "human:requester",
      action: "work_item_created",
      stage: "requirements",
      detail: { inputFiles: inputDocs.map((d) => d.filename) },
    });

    console.log(
      `Work item ${workItem.id} created from ${inputDocs.length} input doc(s), ` +
        `${knowledgeBaseDocs.length} knowledge base doc(s), and ` +
        `${contextLakeDocs.length} context lake doc(s). Calling BA agent...`
    );
    const content = await draftRequirements(modelClient, inputDocs, knowledgeBaseDocs, contextLakeDocs);

    const artifact: RequirementsArtifact = {
      workItemId: workItem.id,
      version: 1,
      content,
      status: "in_review",
      createdAt: new Date().toISOString(),
    };
    await store.saveRequirements(artifact);
    await appendAuditEvent({
      timestamp: artifact.createdAt,
      workItemId: workItem.id,
      actor: "agent:ba-agent",
      action: "agent_drafted_requirements",
      stage: "requirements",
      detail: { version: artifact.version },
    });

    console.log(`\nDraft written: artifacts/${workItem.id}/requirements.v1.md`);
    console.log(`Work item id: ${workItem.id}  (use for show/approve/request-changes)`);
  });

program
  .command("show <workItemId>")
  .description("Print the latest requirements draft for a work item")
  .action(async (workItemId: string) => {
    const artifact = await store.loadLatestRequirements(workItemId);
    console.log(`Status: ${artifact.status}  (v${artifact.version})\n`);
    console.log(artifact.content);
  });

program
  .command("approve <workItemId>")
  .description(
    "BA/PO gate: mark the latest requirements draft approved and write the audit " +
      "record. Does not touch the context lake — see log-context-update."
  )
  .option("-b, --by <name>", "Reviewer name", "unknown-reviewer")
  .option("-n, --note <note>", "Optional review note")
  .action(async (workItemId: string, opts: { by: string; note?: string }) => {
    const artifact = await store.loadLatestRequirements(workItemId);
    artifact.status = "approved";
    artifact.reviewedBy = opts.by;
    artifact.reviewedAt = new Date().toISOString();
    artifact.reviewNote = opts.note;
    await store.saveRequirements(artifact);
    await appendAuditEvent({
      timestamp: artifact.reviewedAt,
      workItemId,
      actor: `human:${opts.by}`,
      action: "ba_approved_requirements",
      stage: "requirements",
      detail: { version: artifact.version, note: opts.note },
    });
    console.log(`Work item ${workItemId} requirements approved by ${opts.by}.`);
    console.log(
      "Next step: follow skills/update-context-lake.md yourself to update the " +
        "context lake for this work item."
    );
  });

program
  .command("log-context-update <workItemId>")
  .description(
    "Deterministic audit write for a context-lake update you performed yourself " +
      "per skills/update-context-lake.md. Call this after you've already appended " +
      "to context/context-lake.md — it does not touch that file or call a model."
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

program
  .command("request-changes <workItemId>")
  .description("BA/PO gate: request changes; re-runs the BA agent with feedback")
  .requiredOption("-n, --note <note>", "Feedback for the agent to address")
  .option("-b, --by <name>", "Reviewer name", "unknown-reviewer")
  .action(async (workItemId: string, opts: { note: string; by: string }) => {
    const modelClient = new OllamaModelClient();
    const prev = await store.loadLatestRequirements(workItemId);
    const workItem = await store.loadWorkItem(workItemId);
    const knowledgeBaseDocs = await loadContextFile(KNOWLEDGE_BASE_PATH);
    const contextLakeDocs = await loadContextFile(CONTEXT_LAKE_PATH);

    await appendAuditEvent({
      timestamp: new Date().toISOString(),
      workItemId,
      actor: `human:${opts.by}`,
      action: "ba_requested_changes",
      stage: "requirements",
      detail: { version: prev.version, note: opts.note },
    });

    console.log("Re-running BA agent with feedback...");
    const inputDocs: LabeledDoc[] = [
      { filename: "original-request.md", content: workItem.rawRequest },
      { filename: `previous-draft-v${prev.version}.md`, content: prev.content },
      { filename: "reviewer-feedback.md", content: opts.note },
    ];
    const content = await draftRequirements(modelClient, inputDocs, knowledgeBaseDocs, contextLakeDocs);

    const artifact: RequirementsArtifact = {
      workItemId,
      version: prev.version + 1,
      content,
      status: "in_review",
      createdAt: new Date().toISOString(),
    };
    await store.saveRequirements(artifact);
    await appendAuditEvent({
      timestamp: artifact.createdAt,
      workItemId,
      actor: "agent:ba-agent",
      action: "agent_drafted_requirements",
      stage: "requirements",
      detail: { version: artifact.version, respondingToNote: opts.note },
    });
    console.log(`New draft written: artifacts/${workItemId}/requirements.v${artifact.version}.md`);
  });

program
  .command("list")
  .description("List all work items and their current status")
  .action(async () => {
    const ids = await store.listWorkItems();
    for (const id of ids) {
      try {
        const item = await store.loadWorkItem(id);
        const artifact = await store.loadLatestRequirements(id);
        console.log(`${id}  [${artifact.status}]  ${item.title}`);
      } catch {
        // skip incomplete/malformed work item dirs
      }
    }
  });

program
  .command("audit <workItemId>")
  .description("Show the audit trail for a work item")
  .action(async (workItemId: string) => {
    const events = await readAuditLog(workItemId);
    for (const e of events) {
      console.log(`${e.timestamp}  ${e.actor.padEnd(24)}  ${e.action}`);
    }
  });

program.parseAsync(process.argv);
