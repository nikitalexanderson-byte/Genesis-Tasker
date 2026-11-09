import type { SharedSavedViewDefinition } from "./cloud-sync";
import type { CalendarContext } from "./calendar-context";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Shape checks only: keep invalid dates/zones editable and let the server validate their meaning. */
export function editableSharedViewDefinition(value: unknown): value is SharedSavedViewDefinition {
  if (!record(value) || value.version !== 1 || typeof value.title !== "string"
    || !["position", "priority", "dueDate", "title", "updatedAt", "createdAt", "createdAtAsc"].includes(String(value.sort))&&!/^custom:[a-zA-Z0-9_-]{1,100}:(asc|desc)$/.test(String(value.sort))
    || !["none", "overdue", "this-week", "this-month"].includes(String(value.relative))
    || !["profane", "sacred", "lunar"].includes(String(value.calendarMode))) return false;
  const context = value.calendarContext;
  if (!record(context) || context.version !== 2 || typeof context.timeZone !== "string"
    || !["january", "march"].includes(String(context.gregorianYearStart))) return false;
  // PHP serializes an empty associative filter as []; no nonempty list is a valid filter.
  const filter = value.filter;
  if (!record(filter)) return Array.isArray(filter) && filter.length === 0;
  if(filter.customFields!==undefined&&(!Array.isArray(filter.customFields)||!filter.customFields.every(row=>record(row)&&typeof row.fieldId==='string'&&['eq','ne','exists','missing','contains','gt','gte','lt','lte'].includes(String(row.op)))))return false;
  for (const key of ["projectIds", "statusIds", "assigneeIds", "labelIds", "tags", "ids"]) {
    if (filter[key] !== undefined && (!Array.isArray(filter[key]) || !(filter[key] as unknown[]).every(item => typeof item === "string"))) return false;
  }
  if (filter.priority !== undefined && (!Array.isArray(filter.priority) || !filter.priority.every(item => Number.isInteger(item) && item >= 0 && item <= 3))) return false;
  for (const key of ["spaceId", "q", "createdBy", "from", "to", "dueFrom", "dueTo"]) {
    if (filter[key] !== undefined && typeof filter[key] !== "string") return false;
  }
  for (const key of ["undated", "approvalPending", "archived", "includeArchived"]) {
    if (filter[key] !== undefined && typeof filter[key] !== "boolean") return false;
  }
  return true;
}

/** Only an explicit repair action supplies context; incomplete filters or relative rules remain invalid. */
export function repairSharedViewContext(value: unknown, context: CalendarContext): SharedSavedViewDefinition | null {
  if (!record(value)) return null;
  const repaired = {...value, calendarContext: context};
  return editableSharedViewDefinition(repaired) ? repaired : null;
}
