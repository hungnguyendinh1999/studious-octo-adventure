import { promises as fs } from "fs";
import path from "path";
import type { LabeledDoc } from "./baAgent.js";

/**
 * BRD "location" is a folder of one or more documents (CLAUDE.md settled
 * decision) — reads every direct file in the folder, skipping dotfiles
 * and subdirectories, sorted by filename for determinism.
 */
export async function loadInputDocsFromFolder(dirPath: string): Promise<LabeledDoc[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const fileNames = entries
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();

  if (fileNames.length === 0) {
    throw new Error(`No documents found in ${dirPath}.`);
  }

  return Promise.all(
    fileNames.map(async (name) => ({
      filename: name,
      content: await fs.readFile(path.join(dirPath, name), "utf-8"),
    }))
  );
}
