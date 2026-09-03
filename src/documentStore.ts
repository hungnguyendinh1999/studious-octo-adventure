import { promises as fs } from "fs";
import path from "path";
import type { DesignArtifact, DesignArtifactType, RequirementsArtifact, WorkItem } from "./types.js";

const ARTIFACT_ROOT = path.resolve(process.cwd(), "artifacts");

function designFilePrefix(type: DesignArtifactType): string {
  return type === "ux_spec" ? "design-ux" : "design-tech";
}

/**
 * DocumentStore: the artifact store / "context lake" for the ADLC.
 *
 * This is a local-filesystem implementation standing in for Outline.
 * Callers (cli.ts) only depend on the methods below, so swapping this for
 * an OutlineStore later means writing a new class with the same methods,
 * not changing anything that calls it.
 */
export class LocalDocumentStore {
  private workItemDir(workItemId: string): string {
    return path.join(ARTIFACT_ROOT, workItemId);
  }

  private async ensureWorkItemDir(workItemId: string): Promise<void> {
    await fs.mkdir(this.workItemDir(workItemId), { recursive: true });
  }

  async saveWorkItem(item: WorkItem): Promise<void> {
    await this.ensureWorkItemDir(item.id);
    await fs.writeFile(
      path.join(this.workItemDir(item.id), "work-item.json"),
      JSON.stringify(item, null, 2)
    );
  }

  async loadWorkItem(workItemId: string): Promise<WorkItem> {
    const raw = await fs.readFile(
      path.join(this.workItemDir(workItemId), "work-item.json"),
      "utf-8"
    );
    return JSON.parse(raw);
  }

  async saveRequirements(artifact: RequirementsArtifact): Promise<void> {
    const dir = this.workItemDir(artifact.workItemId);
    await this.ensureWorkItemDir(artifact.workItemId);

    // Versioned markdown, kept around so every draft is inspectable later.
    await fs.writeFile(
      path.join(dir, `requirements.v${artifact.version}.md`),
      artifact.content
    );
    // Metadata sidecar for that version (status, reviewer, etc).
    await fs.writeFile(
      path.join(dir, `requirements.v${artifact.version}.meta.json`),
      JSON.stringify({ ...artifact, content: "(see .md file)" }, null, 2)
    );
    // "latest" pointer — what `show`, `approve`, `request-changes` act on.
    await fs.writeFile(
      path.join(dir, "requirements.latest.json"),
      JSON.stringify(artifact, null, 2)
    );
  }

  async loadLatestRequirements(workItemId: string): Promise<RequirementsArtifact> {
    const raw = await fs.readFile(
      path.join(this.workItemDir(workItemId), "requirements.latest.json"),
      "utf-8"
    );
    return JSON.parse(raw);
  }

  async saveDesignArtifact(artifact: DesignArtifact): Promise<void> {
    const dir = this.workItemDir(artifact.workItemId);
    await this.ensureWorkItemDir(artifact.workItemId);
    const prefix = designFilePrefix(artifact.type);

    await fs.writeFile(
      path.join(dir, `${prefix}.v${artifact.version}.md`),
      artifact.content
    );
    await fs.writeFile(
      path.join(dir, `${prefix}.v${artifact.version}.meta.json`),
      JSON.stringify({ ...artifact, content: "(see .md file)" }, null, 2)
    );
    await fs.writeFile(
      path.join(dir, `${prefix}.latest.json`),
      JSON.stringify(artifact, null, 2)
    );
  }

  async loadLatestDesignArtifact(
    workItemId: string,
    type: DesignArtifactType
  ): Promise<DesignArtifact> {
    const prefix = designFilePrefix(type);
    const raw = await fs.readFile(
      path.join(this.workItemDir(workItemId), `${prefix}.latest.json`),
      "utf-8"
    );
    return JSON.parse(raw);
  }

  async listWorkItems(): Promise<string[]> {
    await fs.mkdir(ARTIFACT_ROOT, { recursive: true });
    const entries = await fs.readdir(ARTIFACT_ROOT, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }
}
