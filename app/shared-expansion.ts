type ExpandableProject = { id: string; parentId?: string | null; isInbox?: boolean | number };

/** Keep children beside their parent, including projects whose parent is no longer visible. */
export function sharedProjectTree<T extends ExpandableProject>(projects: T[]): { project: T; depth: number }[] {
  const visible = projects.filter(project => !project.isInbox);
  const byId = new Map(visible.map(project => [project.id, project]));
  const visited = new Set<string>();
  const result: { project: T; depth: number }[] = [];
  const visit = (project: T, depth: number) => {
    if (visited.has(project.id)) return;
    visited.add(project.id);
    result.push({ project, depth });
    visible.filter(child => child.parentId === project.id).forEach(child => visit(child, depth + 1));
  };
  visible.filter(project => !project.parentId || !byId.has(project.parentId)).forEach(project => visit(project, 0));
  visible.forEach(project => visit(project, 0));
  return result;
}

/** Destination rows keep the visible ancestry even if only some rows are writable. */
export function sharedProjectDestinations<T extends ExpandableProject & { title: string }>(projects: T[]): { project: T; depth: number; path: string }[] {
  const byId = new Map(projects.map(project => [project.id, project]));
  const rows = [...projects.filter(project => project.isInbox).map(project => ({ project, depth: 0 })), ...sharedProjectTree(projects)];
  return rows.map(row => {
    const titles: string[] = []; const visited = new Set<string>();
    let current: T | undefined = row.project;
    while (current && !visited.has(current.id)) {
      visited.add(current.id); titles.unshift(current.title);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return { ...row, path: titles.join(" › ") };
  });
}

/** Restore a selected project only when its entire path is visible in the saved tree. */
export function restoredSharedProject(projects: ExpandableProject[], expandedIds: string[]): string {
  const expanded = new Set(expandedIds);
  const byId = new Map(projects.map((project) => [project.id, project]));
  for (const id of [...expandedIds].reverse()) {
    const item = byId.get(id);
    if (!item || item.isInbox) continue;
    let parentId = item.parentId;
    const visited = new Set([id]);
    let visible = true;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent || !expanded.has(parentId) || visited.has(parentId)) { visible = false; break; }
      visited.add(parentId);
      parentId = parent.parentId;
    }
    if (visible) return id;
  }
  return "";
}
