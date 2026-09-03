#!/usr/bin/env node
import "dotenv/config";
import { Command, Option } from "commander";
import { nanoid } from "nanoid";
import { promises as fs } from "fs";
import path from "path";
import { LocalDocumentStore } from "./documentStore.js";
import { appendAuditEvent, readAuditLog } from "./auditLog.js";
import { draftRequirements, type LabeledDoc } from "./baAgent.js";
import { loadInputDocsFromFolder } from "./inputLoader.js";
import { OllamaModelClient } from "./modelClient.js";
import type { DesignArtifact, DesignArtifactType, RequirementsArtifact, WorkItem } from "./types.js";

const store = new LocalDocumentStore();
const program = new Command();
const CONTEXT_DIR = path.resolve(process.cwd(), "context");
const KNOWLEDGE_BASE_PATH = path.join(CONTEXT_DIR, "knowledge-base.md");
const CONTEXT_LAKE_PATH = path.join(CONTEXT_DIR, "context-lake.md");

async function loadContextFile(filePath: string): Promise<LabeledDoc[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return [{ filename: path.basename(filePath), content }];
  } catch {
    return [];
  }
}

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

program
  .command("create-work-item <location>")
  .description(
    "Mint a work item from a folder of raw input documents (BRD, notes, etc.) and " +
      "write the audit record. Deterministic — no model call; the harness-agent " +
      "drafts the PRD itself per skills/draft-requirements.md, then calls log-draft."
  )
  .option("-t, --title <title>", "Short title for the work item", "Untitled")
  .action(async (location: string, opts: { title: string }) => {
    const inputDocs = await loadInputDocsFromFolder(path.resolve(location));

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
      `Work item ${workItem.id} created from ${inputDocs.length} input doc(s) in ${location}.`
    );
    console.log(
      "Next step: follow skills/draft-requirements.md yourself to draft the PRD, " +
        `then record it with: log-draft ${workItem.id} --file <path>`
    );
  });

program
  .command("log-draft <workItemId>")
  .description(
    "Save a PRD you drafted yourself as the next version and write the audit " +
      "record. Deterministic — no model call. Version is derived from what's " +
      "already stored, so a re-draft after request-changes becomes the next version."
  )
  .requiredOption("-f, --file <path>", "Path to the drafted PRD markdown file")
  .option("-b, --by <name>", "Which agent produced the draft", "ba-agent")
  .action(async (workItemId: string, opts: { file: string; by: string }) => {
    // Fails loudly if the work item doesn't exist — a draft with no work item
    // behind it would leave an audit trail nothing can be reconciled against.
    await store.loadWorkItem(workItemId);
    const content = await fs.readFile(path.resolve(opts.file), "utf-8");

    const prev = await store
      .loadLatestRequirements(workItemId)
      .catch(() => null);
    const artifact: RequirementsArtifact = {
      workItemId,
      version: prev ? prev.version + 1 : 1,
      content,
      status: "in_review",
      createdAt: new Date().toISOString(),
    };
    await store.saveRequirements(artifact);
    await appendAuditEvent({
      timestamp: artifact.createdAt,
      workItemId,
      actor: `agent:${opts.by}`,
      action: "agent_drafted_requirements",
      stage: "requirements",
      detail: { version: artifact.version },
    });

    console.log(
      `Draft v${artifact.version} recorded: artifacts/${workItemId}/requirements.v${artifact.version}.md`
    );
    console.log(
      `Next step: the BA/PO reviews it (show ${workItemId}), then approve or request-changes.`
    );
  });

program
  .command("draft <location>")
  .description(
    "[EVAL HARNESS ONLY] Run the BA agent on a folder of raw input documents via " +
      "ModelClient; creates a WorkItem + requirements draft. This is an internal " +
      "model-comparison script, not the daily flow — day to day, follow " +
      "skills/draft-requirements.md in your own AI harness instead."
  )
  .option("-t, --title <title>", "Short title for the work item", "Untitled")
  .action(async (location: string, opts: { title: string }) => {
    const modelClient = new OllamaModelClient();
    const inputDocs = await loadInputDocsFromFolder(path.resolve(location));
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
  .description(
    "BA/PO gate: mark the latest draft as changes-requested and write the audit " +
      "record. Does not re-draft — the harness-agent does that per " +
      "skills/draft-requirements.md."
  )
  .requiredOption("-n, --note <note>", "Feedback for the agent to address")
  .option("-b, --by <name>", "Reviewer name", "unknown-reviewer")
  .action(async (workItemId: string, opts: { note: string; by: string }) => {
    const artifact = await store.loadLatestRequirements(workItemId);
    artifact.status = "changes_requested";
    artifact.reviewedBy = opts.by;
    artifact.reviewedAt = new Date().toISOString();
    artifact.reviewNote = opts.note;
    await store.saveRequirements(artifact);
    await appendAuditEvent({
      timestamp: artifact.reviewedAt,
      workItemId,
      actor: `human:${opts.by}`,
      action: "ba_requested_changes",
      stage: "requirements",
      detail: { version: artifact.version, note: opts.note },
    });
    console.log(
      `Changes requested on work item ${workItemId} (v${artifact.version}) by ${opts.by}.`
    );
    console.log(
      "Next step: follow skills/draft-requirements.md yourself to re-draft " +
        `v${artifact.version + 1} addressing this feedback.`
    );
  });

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
