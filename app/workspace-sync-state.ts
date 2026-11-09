import { mergeHabitMeasurementEvents, normalizeHabitRuleHistory } from "./habit-measurement.ts";
import { habitRuleState } from "./habit-rule-history.ts";
import { habitTimerEpoch, habitWorkspaceEpoch, mergeHabitTimerOperations } from "./habit-timer.ts";
import { mergeHabitHistoryEdits } from "./habit-history.ts";
import { mergeHabitLifecycleEvents, projectHabitLifecycle } from "./habit-lifecycle.ts";

export const WORKSPACE_SYNC_SCHEMA_VERSION = 1 as const;

export const WORKSPACE_SYNC_COLLECTIONS = [
  "projects",
  "categories",
  "taskListLinks",
  "taskLists",
  "habits",
  "habitCompletions",
  "habitMeasurements",
  "habitTimers",
  "habitHistory",
  "sleepPlans",
  "sleepEntries",
  "moodEntries",
  "addictionTrackers",
  "addictionEntries",
  "analyticsSnapshots",
  "dailyGoalRecords",
  "quests",
  "achievementUnlocks",
  "rewardTransactions",
  "streakFreezeTransactions",
] as const;

export const WORKSPACE_SYNC_FIELDS = [
  "trackerSchemaVersion",
  "userProgress",
  "habitSettings",
  "hiddenDefaultTemplates",
  "habitTimerEpoch",
] as const;

export type WorkspaceSyncCollection = typeof WORKSPACE_SYNC_COLLECTIONS[number];
export type WorkspaceSyncField = typeof WORKSPACE_SYNC_FIELDS[number];

export type WorkspaceRevision = {
  version: number;
  updatedAt: string;
  deviceId: string;
};

export type WorkspaceTombstone = WorkspaceRevision & {
  collection: WorkspaceSyncCollection;
  id: string;
};

export type WorkspaceSyncMetadata = {
  schemaVersion: typeof WORKSPACE_SYNC_SCHEMA_VERSION;
  entities: Partial<Record<WorkspaceSyncCollection, Record<string, WorkspaceRevision>>>;
  fields: Partial<Record<WorkspaceSyncField, WorkspaceRevision>>;
  tombstones: WorkspaceTombstone[];
};

export type SyncableWorkspaceDocument = Record<string, unknown> & {
  syncMetadata?: WorkspaceSyncMetadata;
};

export type WorkspaceFieldConflict = {
  key: string;
  collection: string;
  entityId: string;
  title: string;
  field: string;
  local: unknown;
  remote: unknown;
};
export type WorkspaceConflictChoices = Record<string, "local" | "remote">;

/** Missing properties in an older writer are not explicit deletions. null/false/0 are values. */
function mergeWorkspaceValue(base: unknown, local: unknown, remote: unknown, path: string[],
  context: Omit<WorkspaceFieldConflict, "key" | "field" | "local" | "remote">,
  conflicts: WorkspaceFieldConflict[], choices?: WorkspaceConflictChoices): unknown {
  if (local === undefined) return remote;
  if (remote === undefined) return local;
  if (canonical(local) === canonical(remote)) return local;
  if (base !== undefined && canonical(local) === canonical(base)) return remote;
  if (base !== undefined && canonical(remote) === canonical(base)) return local;
  if (local && remote && typeof local === "object" && typeof remote === "object"
    && !Array.isArray(local) && !Array.isArray(remote)) {
    const left = local as Record<string, unknown>, right = remote as Record<string, unknown>;
    const original = base && typeof base === "object" ? base as Record<string, unknown> : {};
    return Object.fromEntries([...new Set([...Object.keys(left), ...Object.keys(right)])].map(field => [field,
      // These projections have their own domain mergers below.
      (["updatedAt", "version", "deviceId", "syncState", "xpAwarded", "lifetimeXp", "grossLifetimeXp", "forfeitedHabitXp", "ruleHistory", "lifecycleHistory"].includes(field)
        || (context.collection === "habits" && (Array.isArray(left.ruleHistory) && left.ruleHistory.length > 0 || Array.isArray(right.ruleHistory) && right.ruleHistory.length > 0)
          && ["measurement", "schedule", "periodGoal"].includes(field)))
        ? right[field] ?? left[field]
        : mergeWorkspaceValue(original[field], left[field], right[field], [...path, field], context, conflicts, choices),
    ]));
  }
  const key = JSON.stringify(path);
  if (!choices?.[key]) conflicts.push({ ...context, key, field: path.slice(2).join(" / "), local, remote });
  return choices?.[key] === "local" ? local : remote;
}

type WorkspaceClock = {
  version: number;
  updatedAt: string;
  deviceId: string;
};

const EMPTY_METADATA: WorkspaceSyncMetadata = {
  schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
  entities: {},
  fields: {},
  tombstones: [],
};

function safeVersion(value: unknown) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function safeTimestamp(value: unknown, fallback = "") {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function safeDeviceId(value: unknown, fallback = "legacy") {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : fallback;
}

function normalizeRevision(value: unknown, fallback: WorkspaceClock): WorkspaceRevision {
  const source = value && typeof value === "object" ? value as Partial<WorkspaceRevision> : {};
  return {
    version: Math.max(1, safeVersion(source.version) || safeVersion(fallback.version) || 1),
    updatedAt: safeTimestamp(source.updatedAt, safeTimestamp(fallback.updatedAt, new Date(0).toISOString())),
    deviceId: safeDeviceId(source.deviceId, safeDeviceId(fallback.deviceId)),
  };
}

function revisionOrder(left: WorkspaceRevision, right: WorkspaceRevision) {
  if (left.version !== right.version) return left.version - right.version;
  const timestamp = left.updatedAt.localeCompare(right.updatedAt);
  if (timestamp) return timestamp;
  return left.deviceId.localeCompare(right.deviceId);
}

function newestRevision(left: WorkspaceRevision | undefined, right: WorkspaceRevision | undefined, fallback: WorkspaceClock) {
  if (!left) return right ? normalizeRevision(right, fallback) : normalizeRevision(null, fallback);
  if (!right) return normalizeRevision(left, fallback);
  return revisionOrder(left, right) >= 0 ? normalizeRevision(left, fallback) : normalizeRevision(right, fallback);
}

function nextRevision(previous: WorkspaceRevision | undefined, clock: WorkspaceClock): WorkspaceRevision {
  return {
    version: Math.max(safeVersion(previous?.version) + 1, safeVersion(clock.version), 1),
    updatedAt: safeTimestamp(clock.updatedAt, new Date().toISOString()),
    deviceId: safeDeviceId(clock.deviceId),
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "syncMetadata" && key !== "syncState")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function collectionItems(document: SyncableWorkspaceDocument | null | undefined, collection: WorkspaceSyncCollection) {
  const value = document?.[collection];
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

export function workspaceSyncEntityId(collection: WorkspaceSyncCollection, item: Record<string, unknown>) {
  if (collection === "taskListLinks") return typeof item.taskListId === "string" ? item.taskListId : "";
  if (collection === "dailyGoalRecords") return typeof item.date === "string" ? item.date : "";
  if (collection === "rewardTransactions" || collection === "streakFreezeTransactions") {
    return typeof item.idempotencyKey === "string" && item.idempotencyKey
      ? item.idempotencyKey
      : typeof item.id === "string" ? item.id : "";
  }
  return typeof item.id === "string" ? item.id : "";
}

function collectionMap(document: SyncableWorkspaceDocument | null | undefined, collection: WorkspaceSyncCollection) {
  const result = new Map<string, Record<string, unknown>>();
  collectionItems(document, collection).forEach((item) => {
    const id = workspaceSyncEntityId(collection, item);
    if (id) result.set(id, item);
  });
  return result;
}

export function normalizeWorkspaceSyncMetadata(value: unknown, fallback: WorkspaceClock): WorkspaceSyncMetadata {
  const source = value && typeof value === "object" ? value as Partial<WorkspaceSyncMetadata> : EMPTY_METADATA;
  const entities: WorkspaceSyncMetadata["entities"] = {};
  WORKSPACE_SYNC_COLLECTIONS.forEach((collection) => {
    const raw = source.entities?.[collection];
    if (!raw || typeof raw !== "object") return;
    entities[collection] = Object.fromEntries(Object.entries(raw).flatMap(([id, revision]) => (
      id ? [[id, normalizeRevision(revision, fallback)]] : []
    )));
  });
  const fields: WorkspaceSyncMetadata["fields"] = {};
  WORKSPACE_SYNC_FIELDS.forEach((field) => {
    const revision = source.fields?.[field];
    if (revision) fields[field] = normalizeRevision(revision, fallback);
  });
  const tombstones = Array.isArray(source.tombstones)
    ? source.tombstones.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Partial<WorkspaceTombstone>;
      if (!WORKSPACE_SYNC_COLLECTIONS.includes(candidate.collection as WorkspaceSyncCollection) || typeof candidate.id !== "string" || !candidate.id) return [];
      return [{
        collection: candidate.collection as WorkspaceSyncCollection,
        id: candidate.id,
        ...normalizeRevision(candidate, fallback),
      }];
    })
    : [];
  const latestTombstones = new Map<string, WorkspaceTombstone>();
  tombstones.forEach((tombstone) => {
    const key = `${tombstone.collection}:${tombstone.id}`;
    const previous = latestTombstones.get(key);
    if (!previous || revisionOrder(tombstone, previous) > 0) latestTombstones.set(key, tombstone);
  });
  return {
    schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
    entities,
    fields,
    tombstones: Array.from(latestTombstones.values()).sort((a, b) => (
      a.collection.localeCompare(b.collection) || a.id.localeCompare(b.id)
    )),
  };
}

function inferredRevision(item: Record<string, unknown>, fallback: WorkspaceClock) {
  return normalizeRevision({
    version: item.version,
    updatedAt: item.updatedAt,
    deviceId: item.deviceId,
  }, fallback);
}

function metadataWithDocumentDefaults(document: SyncableWorkspaceDocument, metadata: WorkspaceSyncMetadata, fallback: WorkspaceClock) {
  const next = normalizeWorkspaceSyncMetadata(metadata, fallback);
  WORKSPACE_SYNC_COLLECTIONS.forEach((collection) => {
    const revisions = { ...(next.entities[collection] ?? {}) };
    collectionItems(document, collection).forEach((item) => {
      const id = workspaceSyncEntityId(collection, item);
      if (id && !revisions[id]) revisions[id] = inferredRevision(item, fallback);
    });
    next.entities[collection] = revisions;
  });
  WORKSPACE_SYNC_FIELDS.forEach((field) => {
    if (!next.fields[field] && field in document) next.fields[field] = normalizeRevision(null, fallback);
  });
  return next;
}

export function prepareWorkspaceForSync(input: {
  current: SyncableWorkspaceDocument;
  base?: SyncableWorkspaceDocument | null;
  metadata?: WorkspaceSyncMetadata | null;
  baseMetadata?: WorkspaceSyncMetadata | null;
  clock: WorkspaceClock;
}) {
  const current = { ...input.current };
  delete current.syncMetadata;
  const base = input.base ? { ...input.base } : null;
  if (base) delete base.syncMetadata;
  // Partial writers must not turn an absent collection/field into a deletion.
  if (base) Object.entries(base).forEach(([field, value]) => {
    if (!(field in current)) current[field] = value;
  });
  let metadata = metadataWithDocumentDefaults(current, normalizeWorkspaceSyncMetadata(input.metadata, input.clock), input.clock);
  const baseMetadata = base
    ? metadataWithDocumentDefaults(base, normalizeWorkspaceSyncMetadata(input.baseMetadata, input.clock), input.clock)
    : normalizeWorkspaceSyncMetadata(null, input.clock);
  const tombstones = new Map(metadata.tombstones.map((item) => [`${item.collection}:${item.id}`, item]));

  WORKSPACE_SYNC_COLLECTIONS.forEach((collection) => {
    const currentById = collectionMap(current, collection);
    const baseById = collectionMap(base, collection);
    const revisions = { ...(metadata.entities[collection] ?? {}) };
    currentById.forEach((item, id) => {
      const baseItem = baseById.get(id);
      const previous = revisions[id] ?? baseMetadata.entities[collection]?.[id];
      const changed = !baseItem || canonical(item) !== canonical(baseItem);
      if (changed) {
        const intrinsic = inferredRevision(item, input.clock);
        const baseRevision = baseMetadata.entities[collection]?.[id];
        revisions[id] = baseRevision && revisionOrder(intrinsic, baseRevision) > 0
          ? intrinsic
          : nextRevision(previous ?? baseRevision, input.clock);
      } else {
        revisions[id] = newestRevision(previous, baseMetadata.entities[collection]?.[id], input.clock);
      }
      const tombstoneKey = `${collection}:${id}`;
      const tombstone = tombstones.get(tombstoneKey);
      if (tombstone && revisionOrder(revisions[id], tombstone) > 0) tombstones.delete(tombstoneKey);
    });
    baseById.forEach((_item, id) => {
      if (currentById.has(id)) return;
      const key = `${collection}:${id}`;
      const deleted = nextRevision(baseMetadata.entities[collection]?.[id] ?? revisions[id], input.clock);
      const tombstone: WorkspaceTombstone = { collection, id, ...deleted };
      const previous = tombstones.get(key);
      if (!previous || revisionOrder(tombstone, previous) > 0) tombstones.set(key, tombstone);
      delete revisions[id];
    });
    metadata.entities[collection] = revisions;
  });

  WORKSPACE_SYNC_FIELDS.forEach((field) => {
    const currentValue = current[field];
    const baseValue = base?.[field];
    const previous = metadata.fields[field] ?? baseMetadata.fields[field];
    metadata.fields[field] = !base || canonical(currentValue) !== canonical(baseValue)
      ? nextRevision(previous, input.clock)
      : newestRevision(previous, baseMetadata.fields[field], input.clock);
  });

  metadata = { ...metadata, tombstones: Array.from(tombstones.values()) };
  return { document: { ...current, syncMetadata: metadata }, metadata };
}

function mergeMetadata(left: WorkspaceSyncMetadata, right: WorkspaceSyncMetadata, fallback: WorkspaceClock) {
  const merged = normalizeWorkspaceSyncMetadata(null, fallback);
  WORKSPACE_SYNC_COLLECTIONS.forEach((collection) => {
    const ids = new Set([
      ...Object.keys(left.entities[collection] ?? {}),
      ...Object.keys(right.entities[collection] ?? {}),
    ]);
    merged.entities[collection] = Object.fromEntries(Array.from(ids).map((id) => [
      id,
      newestRevision(left.entities[collection]?.[id], right.entities[collection]?.[id], fallback),
    ]));
  });
  WORKSPACE_SYNC_FIELDS.forEach((field) => {
    merged.fields[field] = newestRevision(left.fields[field], right.fields[field], fallback);
  });
  const tombstones = new Map<string, WorkspaceTombstone>();
  [...left.tombstones, ...right.tombstones].forEach((item) => {
    const key = `${item.collection}:${item.id}`;
    const previous = tombstones.get(key);
    if (!previous || revisionOrder(item, previous) > 0) tombstones.set(key, item);
  });
  merged.tombstones = Array.from(tombstones.values());
  return merged;
}

export function mergeWorkspaceDocuments(input: {
  left: SyncableWorkspaceDocument;
  right: SyncableWorkspaceDocument;
  leftFallback: WorkspaceClock;
  rightFallback: WorkspaceClock;
  base?: SyncableWorkspaceDocument | null;
  reviewConflicts?: boolean;
  choices?: WorkspaceConflictChoices;
}) {
  const conflicts: WorkspaceFieldConflict[] = [];
  const leftMetadata = metadataWithDocumentDefaults(
    input.left,
    normalizeWorkspaceSyncMetadata(input.left.syncMetadata, input.leftFallback),
    input.leftFallback,
  );
  const rightMetadata = metadataWithDocumentDefaults(
    input.right,
    normalizeWorkspaceSyncMetadata(input.right.syncMetadata, input.rightFallback),
    input.rightFallback,
  );
  const mergedMetadata = mergeMetadata(leftMetadata, rightMetadata, {
    version: Math.max(input.leftFallback.version, input.rightFallback.version),
    updatedAt: input.leftFallback.updatedAt >= input.rightFallback.updatedAt ? input.leftFallback.updatedAt : input.rightFallback.updatedAt,
    deviceId: input.leftFallback.deviceId >= input.rightFallback.deviceId ? input.leftFallback.deviceId : input.rightFallback.deviceId,
  });
  const merged: SyncableWorkspaceDocument = { ...input.left, ...input.right };
  if (input.reviewConflicts) Object.keys(merged).forEach(field => {
    if (field === "syncMetadata" || WORKSPACE_SYNC_COLLECTIONS.includes(field as WorkspaceSyncCollection)
      || WORKSPACE_SYNC_FIELDS.includes(field as WorkspaceSyncField)) return;
    merged[field] = mergeWorkspaceValue(input.base?.[field], input.left[field], input.right[field],
      [field, "settings"], { collection: field, entityId: "", title: field }, conflicts, input.choices);
  });

  WORKSPACE_SYNC_COLLECTIONS.forEach((collection) => {
    const leftItems = collectionMap(input.left, collection);
    const rightItems = collectionMap(input.right, collection);
    const baseItems = collectionMap(input.base, collection);
    const historyRows = collection === "habitHistory" ? new Map(mergeHabitHistoryEdits([...leftItems.values()], [...rightItems.values()]).map(row => [row.id, row])) : null;
    const ids = new Set([...leftItems.keys(), ...rightItems.keys()]);
    const tombstones = new Map(mergedMetadata.tombstones
      .filter((item) => item.collection === collection)
      .map((item) => [item.id, item]));
    const values: Record<string, unknown>[] = [];
    ids.forEach((id) => {
      const leftItem = leftItems.get(id);
      const rightItem = rightItems.get(id);
      const leftRevision = leftMetadata.entities[collection]?.[id];
      const rightRevision = rightMetadata.entities[collection]?.[id];
      let winner = leftItem;
      let winnerRevision = leftRevision;
      if (!winner || (rightItem && revisionOrder(
        normalizeRevision(rightRevision, input.rightFallback),
        normalizeRevision(leftRevision, input.leftFallback),
      ) > 0)) {
        winner = rightItem;
        winnerRevision = rightRevision;
      } else if (leftItem && rightItem && revisionOrder(
        normalizeRevision(rightRevision, input.rightFallback),
        normalizeRevision(leftRevision, input.leftFallback),
      ) === 0 && canonical(rightItem) > canonical(leftItem)) {
        winner = rightItem;
        winnerRevision = rightRevision;
      }
      if (!winner) return;
      const domainEvents = ["habitHistory", "habitMeasurements", "habitTimers"].includes(collection);
      if (input.reviewConflicts && !domainEvents) {
        const baseItem = baseItems.get(id);
        const leftDeleted = leftMetadata.tombstones.some(row => row.collection === collection && row.id === id);
        const rightDeleted = rightMetadata.tombstones.some(row => row.collection === collection && row.id === id);
        const context = { collection, entityId: id, title: String(leftItem?.title ?? rightItem?.title ?? leftItem?.name ?? rightItem?.name ?? id) };
        if (leftItem && rightItem) {
          winner = mergeWorkspaceValue(baseItem, leftItem, rightItem, [collection, id], context, conflicts, input.choices) as Record<string, unknown>;
        } else if (leftDeleted || rightDeleted) {
          const remaining = leftItem ?? rightItem;
          // Delete against an unchanged record is safe; delete against an edit needs a decision.
          if (baseItem && canonical(remaining) === canonical(baseItem)) return;
          const key = JSON.stringify([collection, id]);
          if (!input.choices?.[key]) conflicts.push({ ...context, key, field: "", local: leftDeleted ? null : leftItem, remote: rightDeleted ? null : rightItem });
          winner = input.choices?.[key] === "local" ? (leftDeleted ? undefined : leftItem) : (rightDeleted ? undefined : rightItem);
          if (!winner) return;
          mergedMetadata.tombstones = mergedMetadata.tombstones.filter(row => row.collection !== collection || row.id !== id);
          tombstones.delete(id);
          winnerRevision = nextRevision(newestRevision(leftRevision, rightRevision, input.leftFallback), input.leftFallback);
        }
      }
      if (collection === "habitCompletions" && leftItem && rightItem
        && habitTimerEpoch(input.left.habitTimerEpoch) === habitTimerEpoch(input.right.habitTimerEpoch)) winner = { ...winner,
        xpAwarded: Math.max(Number(leftItem.xpAwarded) || 0, Number(rightItem.xpAwarded) || 0) };
      if (historyRows) winner = historyRows.get(id) as unknown as Record<string, unknown>;
      if (collection === "habitMeasurements") {
        const events = mergeHabitMeasurementEvents(leftItem ? [leftItem] : [], rightItem ? [rightItem] : []);
        winner = events[0] as unknown as Record<string, unknown>;
      }
      if (collection === "habitTimers") {
        winner = mergeHabitTimerOperations(leftItem ? [leftItem] : [], rightItem ? [rightItem] : [])[0] as unknown as Record<string, unknown>;
      }
      if (collection === "habits" && leftItem && rightItem) {
        const ruleHistory = normalizeHabitRuleHistory([
          ...(Array.isArray(leftItem.ruleHistory) ? leftItem.ruleHistory : []),
          ...(Array.isArray(rightItem.ruleHistory) ? rightItem.ruleHistory : []),
        ]);
        const latestRule = ruleHistory.length ? habitRuleState({ ...winner, ruleHistory } as Parameters<typeof habitRuleState>[0], "9999-12-31").rule : null;
          const lifecycleHistory = mergeHabitLifecycleEvents(leftItem.lifecycleHistory, rightItem.lifecycleHistory);
          winner = { ...winner, ruleHistory, lifecycleHistory,
          // An old draft has neither the definition nor its history. Recover it without erasing remote values.
          measurement: latestRule ? latestRule.measurement : winner.measurement ?? leftItem.measurement ?? rightItem.measurement ?? null,
          // Finite practice policy is fixed at creation; an older client must not erase it.
          practiceGoal: winner.practiceGoal ?? leftItem.practiceGoal ?? rightItem.practiceGoal ?? null,
          ...(latestRule ? { schedule: latestRule.schedule, periodGoal: latestRule.periodGoal ?? null } : {}),
          };
          if (lifecycleHistory.length) winner = projectHabitLifecycle(winner as Parameters<typeof projectHabitLifecycle>[0]) as unknown as Record<string, unknown>;
      }
      const tombstone = tombstones.get(id);
      if (tombstone && revisionOrder(tombstone, normalizeRevision(winnerRevision, input.leftFallback)) >= 0) {
        delete mergedMetadata.entities[collection]?.[id];
        return;
      }
      values.push(winner);
      if (winnerRevision) mergedMetadata.entities[collection]![id] = winnerRevision;
    });
    merged[collection] = values.sort((a, b) => workspaceSyncEntityId(collection, a).localeCompare(workspaceSyncEntityId(collection, b)));
  });

  WORKSPACE_SYNC_FIELDS.forEach((field) => {
    const leftRevision = leftMetadata.fields[field];
    const rightRevision = rightMetadata.fields[field];
    if (field === "habitTimerEpoch") {
      const leftEpoch = habitTimerEpoch(input.left[field]), rightEpoch = habitTimerEpoch(input.right[field]);
      merged[field] = leftEpoch >= rightEpoch ? leftEpoch : rightEpoch;
      return;
    }
    const order = revisionOrder(
      normalizeRevision(leftRevision, input.leftFallback),
      normalizeRevision(rightRevision, input.rightFallback),
    );
    if (order > 0) merged[field] = input.left[field];
    else if (order < 0) merged[field] = input.right[field];
    else merged[field] = canonical(input.left[field]) >= canonical(input.right[field]) ? input.left[field] : input.right[field];
    if (input.reviewConflicts) merged[field] = mergeWorkspaceValue(input.base?.[field], input.left[field], input.right[field],
      [field, "settings"], { collection: field, entityId: "", title: field }, conflicts, input.choices);
  });
  const history = Array.isArray(merged.habitHistory) ? merged.habitHistory : [];
  if (habitTimerEpoch(input.left.habitTimerEpoch) === habitTimerEpoch(input.right.habitTimerEpoch)
    && merged.userProgress && typeof merged.userProgress === "object") {
    const left = input.left.userProgress as Record<string, unknown> | undefined, right = input.right.userProgress as Record<string, unknown> | undefined;
    merged.userProgress = { ...merged.userProgress, lifetimeXp: Math.max(Number(left?.lifetimeXp) || 0, Number(right?.lifetimeXp) || 0),
      ...(left?.grossLifetimeXp !== undefined || right?.grossLifetimeXp !== undefined ? {
        grossLifetimeXp: Math.max(Number(left?.grossLifetimeXp ?? left?.lifetimeXp) || 0, Number(right?.grossLifetimeXp ?? right?.lifetimeXp) || 0),
        forfeitedHabitXp: Math.max(Number(left?.forfeitedHabitXp) || 0, Number(right?.forfeitedHabitXp) || 0),
      } : {}) };
  }
  const epoch = habitTimerEpoch(merged.habitTimerEpoch);
  merged.habitTimerEpoch = habitWorkspaceEpoch(epoch, history.some(row => row && row.epoch === epoch),
    Array.isArray(merged.habits) && merged.habits.some(row => Array.isArray(row.lifecycleHistory) && row.lifecycleHistory.length > 0)
      || history.some(row => row?.source === "decision") || Array.isArray(merged.habitCompletions) && merged.habitCompletions.some(row => row.skippedAt));
  merged.syncMetadata = mergedMetadata;
  return { document: merged, metadata: mergedMetadata, conflicts };
}

/** Import two formerly independent accounts without applying either account's tombstones. */
export function mergeIndependentWorkspaceDocuments(input: {
  primary: SyncableWorkspaceDocument;
  secondary: SyncableWorkspaceDocument;
  defaults: SyncableWorkspaceDocument;
  clock: WorkspaceClock;
}) {
  const combined: SyncableWorkspaceDocument = {};
  WORKSPACE_SYNC_COLLECTIONS.forEach((collection) => {
    const primary = collectionMap(input.primary, collection);
    const secondary = collectionMap(input.secondary, collection);
    secondary.forEach((item, id) => {
      const existing = primary.get(id);
      if (existing && canonical(existing) !== canonical(item)) {
        throw new Error("Обнаружены разные записи с одинаковым ID. Оба аккаунта оставлены отдельно.");
      }
      primary.set(id, item);
    });
    combined[collection] = Array.from(primary.values());
  });
  WORKSPACE_SYNC_FIELDS.forEach((field) => {
    const primary = input.primary[field];
    const secondary = input.secondary[field];
    if (field === "trackerSchemaVersion") {
      combined[field] = Math.max(Number(primary) || 0, Number(secondary) || 0);
    } else if (field === "hiddenDefaultTemplates") {
      combined[field] = Array.from(new Set([
        ...(Array.isArray(primary) ? primary : []),
        ...(Array.isArray(secondary) ? secondary : []),
      ]));
    } else if (canonical(primary) === canonical(secondary) || canonical(secondary) === canonical(input.defaults[field])) {
      combined[field] = primary;
    } else if (canonical(primary) === canonical(input.defaults[field])) {
      combined[field] = secondary;
    } else {
      throw new Error("Настройки и прогресс двух аккаунтов различаются. Оба аккаунта оставлены отдельно.");
    }
  });
  return prepareWorkspaceForSync({ current: combined, clock: input.clock });
}
