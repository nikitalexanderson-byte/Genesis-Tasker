import type { SharedPermissions } from "./cloud-sync";

export type ProjectGrantRole = "member" | "commenter" | "viewer" | "none";
export type SharedProjectGrant = { projectId: string; role: ProjectGrantRole; includeDescendants: boolean };
export type SharedProjectAccessDraft = { allProjects: boolean; grants: SharedProjectGrant[] };
export type ProjectAccessPermissions = SharedPermissions & { read: boolean };
export type SharedAccessProject = { id: string; title: string; parentId: string | null; isInbox: number; archivedAt: string | null;
  inTrash: number; revision: number; role: string | null; assignedTaskCount: number };
export type SharedProjectAccessState = SharedProjectAccessDraft & {
  spaceId: string; userId: string; memberRole: string; restricted: boolean; revision: number; fingerprint: string;
  projects: SharedAccessProject[]; spacePermissions: SharedPermissions; permissionsOverride: SharedPermissions | null; canOrganizeTasks: boolean;
};
export type SharedProjectAccessPreview = {
  fingerprint: string; revision: number; desired: SharedProjectAccessDraft; projects: SharedAccessProject[];
  blockers: { projectId: string; code: "LAST_OWNER" }[]; effectiveRoles: Record<string, string | null>;
  changes: { projectId: string; title: string; from: string | null; to: string | null; clearedAssignments: number;
    beforePermissions: ProjectAccessPermissions; afterPermissions: ProjectAccessPermissions }[];
};
export type SharedProjectAccessCommand = SharedProjectAccessDraft & { expectedFingerprint: string; operationId: string };
