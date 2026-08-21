import { promises as fs } from "fs";
import path from "path";
import type { ModelClient } from "./modelClient.js";

const SKILL_PATH = path.resolve(process.cwd(), "skills/draft-requirements.md");

export interface LabeledDoc {
  filename: string;
  content: string;
}

function renderDocs(label: string, docs: LabeledDoc[]): string {
  if (docs.length === 0) return "";
  const rendered = docs
    .map((d) => `--- ${d.filename} ---\n${d.content}`)
    .join("\n\n");
  return `${label}:\n${rendered}`;
}

export async function draftRequirements(
  modelClient: ModelClient,
  inputDocs: LabeledDoc[],
  knowledgeBaseDocs: LabeledDoc[] = [],
  contextLakeDocs: LabeledDoc[] = []
): Promise<string> {
  if (inputDocs.length === 0) {
    throw new Error("At least one input document is required.");
  }

  const skill = await fs.readFile(SKILL_PATH, "utf-8");

  const sections = [
    renderDocs("Knowledge base context (human-curated)", knowledgeBaseDocs),
    renderDocs("Context lake context (agent-accumulated from approvals)", contextLakeDocs),
    renderDocs("Raw input documents", inputDocs),
  ].filter(Boolean);

  return modelClient.complete(skill, sections.join("\n\n---\n\n"), 4000);
}
