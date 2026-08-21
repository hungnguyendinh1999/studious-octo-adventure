import { promises as fs } from "fs";
import path from "path";
import type { ModelClient } from "./modelClient.js";

const SKILL_PATH = path.resolve(process.cwd(), "skills/update-context-lake.md");

/**
 * Runs only after BA/PO approval (see cli.ts `approve` command). Returns
 * a markdown snippet to append to context/context-lake.md, or null if
 * the agent found nothing durable worth keeping.
 */
export async function extractContextLakeUpdate(
  modelClient: ModelClient,
  approvedContent: string,
  workItemId: string,
  existingContextLake: string
): Promise<string | null> {
  const skill = await fs.readFile(SKILL_PATH, "utf-8");

  const userContent =
    `Work item: WI-${workItemId}\n\n` +
    `Current context lake:\n${existingContextLake}\n\n---\n\n` +
    `Approved requirements document:\n${approvedContent}`;

  const result = (await modelClient.complete(skill, userContent, 1000)).trim();
  return result === "NO_NEW_KNOWLEDGE" ? null : result;
}
