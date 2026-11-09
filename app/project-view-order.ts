export const PROJECT_VIEWS = ["list", "board", "calendar", "gantt"] as const;
export type ProjectView = (typeof PROJECT_VIEWS)[number];

export function projectViewOrder(value: unknown): ProjectView[] | null {
  if (!Array.isArray(value) || value.length !== PROJECT_VIEWS.length || new Set(value).size !== PROJECT_VIEWS.length ||
      value.some(item => !PROJECT_VIEWS.includes(item))) return null;
  return [...value];
}

export function moveProjectView(order: readonly ProjectView[], source: ProjectView, target: ProjectView): ProjectView[] {
  const next = [...order], from = next.indexOf(source), to = next.indexOf(target);
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(from, 1); next.splice(to, 0, source); return next;
}

export function defaultProjectView(order: readonly ProjectView[] | null, compact: boolean, layout?: "list" | "board"): ProjectView {
  return order?.[0] ?? (compact ? "list" : layout ?? "list");
}

export function sameLayoutValue(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right) ? left.length === right.length && left.every((value, i) => value === right[i]) : left === right;
}
