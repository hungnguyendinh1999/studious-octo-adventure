export type GateStatus = "draft" | "in_review" | "approved" | "changes_requested";

export interface WorkItem {
  id: string;
  title: string;
  rawRequest: string;
  createdAt: string;
}

export interface RequirementsArtifact {
  workItemId: string;
  version: number;
  content: string; // the agent-drafted requirements markdown
  status: GateStatus;
  createdAt: string;
  reviewNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export type DesignArtifactType = "ux_spec" | "tech_design";

export interface DesignArtifact {
  workItemId: string;
  type: DesignArtifactType;
  version: number;
  content: string; // the agent-drafted design markdown (UX/UI spec or technical/system design)
  status: GateStatus;
  createdAt: string;
  reviewNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface AuditEvent {
  timestamp: string;
  workItemId: string;
  actor: string; // "agent:ba-agent" or "human:<name>"
  action: string; // e.g. "agent_drafted_requirements", "ba_approved_requirements"
  stage: string; // "requirements" | "design" (tasks in later phases)
  detail?: Record<string, unknown>;
}
