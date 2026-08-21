import { promises as fs } from "fs";
import path from "path";
import type { AuditEvent } from "./types.js";

const AUDIT_DIR = path.resolve(process.cwd(), "audit");
const AUDIT_FILE = path.join(AUDIT_DIR, "log.jsonl");

/**
 * Append-only audit log, one JSON object per line.
 *
 * Standing in for the "insert-only Postgres table" (and eventually immudb)
 * from the design doc: same event shape, same append-only guarantee in
 * spirit. Swapping the storage target later means changing this file only —
 * every caller just calls appendAuditEvent().
 */
export async function appendAuditEvent(event: AuditEvent): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.appendFile(AUDIT_FILE, JSON.stringify(event) + "\n");
}

export async function readAuditLog(workItemId?: string): Promise<AuditEvent[]> {
  try {
    const raw = await fs.readFile(AUDIT_FILE, "utf-8");
    const events = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditEvent);
    return workItemId ? events.filter((e) => e.workItemId === workItemId) : events;
  } catch {
    return [];
  }
}
