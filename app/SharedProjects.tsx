/* eslint-disable @next/next/no-img-element -- User-provided board pictures remain native img elements. */
"use client";
import "./shared-dialog-ui.css";
import { SharedBoardColor } from "./SharedBoardColor";
import { DialogCloseButton } from "./DialogCloseButton";
import { foregroundRefresh } from "./foreground-refresh";
import { useSacredFeaturesEnabled } from "./sacred-features";
import { getSolarEvent } from "./calendar-data";
import { useMobileLayout } from "./use-mobile-layout";
import { SharedTaskViewControls } from "./SharedTaskViewControls";
import calendarScaleCopy from "./calendar-scale-copy.json";
import { sharedCalendarPeriod, sharedCalendarWindow, type CalendarScale } from "./shared-calendar-period";
import { SharedCustomFieldInputs, SharedCustomFieldValues } from "./SharedCustomFieldInputs";
import { SharedCustomFieldFilter } from "./SharedCustomFieldFilter";
import { customFieldsError, type CustomFieldValues, type CustomFieldCriterion } from "./shared-custom-fields";
import {useSharedTaskSort} from "./use-personal-task-display";
import {MindmapLaunchButton} from "./MindmapLaunchButton";
import { SharedEstimateInputs, SharedEstimateValues } from './SharedTaskEstimates';
import { SharedMemberMessageButton } from './SharedMemberMessageButton';
import {messengerText} from './messenger-copy';
import { estimateDraft, estimateInput, planningText, type EstimateDraft } from './shared-planning';
import {sharedProjectQuotaAvailable} from './shared-project-quota';
import billingFeatureCopy from './billing-feature-copy.json';

import { type ReactNode, type CSSProperties, type FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { lazyWithRecovery as lazy } from "./DeferredViews";
import { SharedArchivedTasks } from "./SharedArchivedTasks";
import { SharedTaskWatch } from "./SharedNotificationPreferences";
import { setSharedTaskArchived, restoreSharedTrash, type SharedTrashEntry } from "./cloud-sync";
import { SharedTaskDetailsEditor, SharedTaskReadOnlyMetadata, taskDetailsDraft } from "./SharedTaskDetailsEditor";
import { sharedTaskDetailsError, sharedPriorityLabel, type SharedTaskDetailsDraft } from "./shared-task-details";
import { useSharedTaskPage } from "./use-shared-task-page";
import { useCalendarTaskPreviews } from "./use-calendar-task-previews";
import { CalendarCellTasks } from "./CalendarCellTasks";
import { SharedTaskPageControls, SharedTaskPageCount } from "./SharedTaskPageControls";
import { sharedMovePreview } from './shared-move-preview';
import { SharedTaskBatches } from "./SharedTaskBatches";
import {
  searchSharedAffairs, type SharedAffairSearch,
  listSharedLabels, type SharedLabel,
  listSharedProjectCategories,
  loadSharedUiState, saveSharedUiState, listSharedInvitations, acceptSharedInvitation,
  rejectSharedInvitation, inviteSharedSpaceMember, type SharedInvitation, type SharedStatus,
  addSharedComment, changeSharedMemberRole,
  createSharedProject, createSharedStatus,
  deleteSharedStatus, deleteSharedTask, updateSharedStatus,
  createSharedTask, listSharedComments, listSharedProjects,
  loadSharedTask, convertSharedChecklistItem,
  listArchivedSharedProjects, loadSharedSpaceDirectory, loadSharedProject, removeSharedMember,
  loadSharedGoogleSettings, setSharedProjectArchived, syncSharedGoogle,
  updateSharedGoogleSettings, updateSharedProject, updateSharedTask, moveSharedTask,
  approveSharedTask,
  queuedSharedMutations, discardSharedMutation, sharedDataCameFromOfflineCache,
  type SharedComment, type SharedProject, type SharedProjectSnapshot,
  type SharedSpace, type SharedProjectQuota, type SharedTask, type SharedGoogleSettings, type SharedCalendarTask,
} from "./cloud-sync";
import "./shared-projects.css";
import "./shared-projects-layout.css";
import "./shared-workspace-toolbar.css";
import "./calendar-cell-tasks.css";
import "./task-list-entry.css";
const SharedSavedViews = lazy(() => import("./SharedSavedViews").then(module => ({default:module.SharedSavedViews})));
const SharedCustomFieldManager = lazy(() => import("./SharedCustomFieldManager").then(module => ({default:module.SharedCustomFieldManager})));
const SharedTemplates = lazy(() => import("./SharedTemplates").then(module => ({default:module.SharedTemplates})));
const SharedPlanning = lazy(() => import('./SharedPlanning').then(module=>({default:module.SharedPlanning})));
const SharedWorkflowDialog = lazy(() => import('./SharedWorkflowDialog').then(module=>({default:module.SharedWorkflowDialog})));
const SharedAutomations = lazy(() => import("./SharedAutomations").then(module => ({default:module.SharedAutomations})));
const SharedDataExchange = lazy(() => import("./SharedDataExchange").then(module => ({default:module.SharedDataExchange})));
const SharedTeamReports = lazy(() => import("./SharedTeamReports").then(module => ({default:module.SharedTeamReports})));
import "./shared-collaboration.css";
import { ProjectsHeroMark } from "./ProjectsHeroMark";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { SharedWorkspaceIdentity } from "./SharedWorkspaceIdentity";
import { SharedProjectCategories } from "./SharedProjectCategories";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { IconActionButton } from "./IconActionButton";
import { workflowText } from './workflow-copy';
import { ActionNotice, useActionNotice } from "./ActionNotice";
import { ProjectCompletionDialog } from "./ProjectCompletionDialog";
import { useAffairDrag } from "./use-affair-drag";
import { SharedSpaceCover } from "./SharedSpaceCover";
import { SharedSpaceForm } from "./SharedSpaceForm";
import { SharedTeamPermissions } from "./SharedTeamPermissions";
import { SharedTaskApprovalChoice } from "./SharedTaskApprovalChoice";
import { EntryTypeChoice, entryTypeLabel, entryTypeTitlePlaceholder, type EntryType } from "./EntryTypeChoice";
import { SharedLabelBadges, SharedLabelPicker, SharedLabelsDialog } from "./SharedLabels";
import { SharedProjectLabels } from "./SharedProjectLabels";
import { SharedComments } from "./SharedComments";
import { useSharedTaskRead } from "./use-shared-task-read";
import { SharedActivity } from "./SharedActivity";
import { SharedTaskImage } from "./SharedTaskImage";
import { SharedTaskAttachmentsInput, SharedTaskAttachmentList, taskFileError, type TaskFileDraft } from "./SharedTaskAttachments";
import { SharedWorkspaceSummary } from "./SharedUpdates";
import { initialSharedPlace, recordSharedPlace, sharedPlaceFromUrl } from "./shared-navigation";
import { SharedGantt } from "./SharedGantt";
import { boardDisplay, boardTaskGroups } from "./shared-board-display";
import { SharedBoardTaskTitle } from "./SharedBoardTaskTitle";
import { SharedTaskDetails } from "./SharedTaskDetails";
import { dateSerial, serialDate, ganttSchedule, ganttAxisPoint, ganttTaskGroups, ganttUnscheduledSchedule, type GanttScale, type GanttSchedule, type GanttTaskDates, type GanttReturnTarget } from "./shared-gantt";
import { SharedTaskSchedule, emptySharedPlan, taskSharedPlan } from "./SharedTaskSchedule";
import { formatTimeValue, type TimeFormat } from "./time-format";
type SharedDragItem = { id: string; title: string } & ({ kind: "task"; task: SharedTask } | { kind: "container"; project: SharedProject });
type SharedDropTarget = GanttReturnTarget & { schedule?:GanttSchedule; ganttRow?:string; calendarDate?:string };
import { RecordCalendarChoice } from "./RecordCalendarChoice";
import { type CalendarMode, MONTHS, LUNAR_DECADES, ELEMENTS, formatCalendarDate, formatGregorian, getLunarDate, getSacredDate, getSacredDay } from "./calendar-data";
import { formatTranslatedText, translateText } from "./i18n";
import { restoredSharedProject, sharedProjectTree } from "./shared-expansion";
import { formatTaskCount } from "./task-count-i18n";
import type { InboxPosition } from "./ui-visibility";
import { InboxToolbar, InboxRestore, InboxResizeBoundary } from "./InboxToolbar";
import { isSharedInboxTask, sharedTaskDropPosition } from "./shared-inbox-drop";
import { ProjectViewSwitch } from "./ProjectViewSwitch";
import { defaultProjectView, type ProjectView } from "./project-view-order";

import { SharedTaskReview } from "./SharedTaskReview";
import { SharedReviewSettings } from "./SharedReviewSettings";
import { SharedTrash, SharedTrashConfirmation } from "./SharedTrash";
import { trashSharedProject } from "./cloud-sync";
const sharedMindmapsEnabled = process.env.NEXT_PUBLIC_GENESIS_MINDMAPS === "true";
const SharedMindmaps = lazy(() => import("./SharedMindmaps"));
const SharedEntityPreview = lazy(() => import("./SharedEntityPreview"));
const SharedSpaceCollaboration = lazy(() => import("./SharedSpaceCollaboration"));
const SharedTaskSeries = lazy(() => import("./SharedTaskSeries"));
const compactQuery = () => window.matchMedia("(max-width: 1099px)");
const subscribeCompact = (listener: () => void) => { const query = compactQuery(); query.addEventListener("change", listener); return () => query.removeEventListener("change", listener); };
const compactSnapshot = () => compactQuery().matches;
const serverCompactSnapshot = () => false;
const SHARED_RETRY_EVENT = "genesis:shared-retry";
function watchSharedRead(operation: (signal: AbortSignal) => Promise<unknown>, success: () => void,
  failure: (error: unknown) => void, settled?: () => void) {
  // The first visible read may restore the protected cache while already offline.
  const refresh = foregroundRefresh(operation, { available: initial => (initial || navigator.onLine) && document.visibilityState === "visible", success, failure, settled });
  const trigger = () => void refresh.trigger();
  window.addEventListener("focus", trigger); window.addEventListener("online", trigger);
  window.addEventListener(SHARED_RETRY_EVENT, trigger); document.addEventListener("visibilitychange", trigger);
  return () => { refresh.stop(); window.removeEventListener("focus", trigger); window.removeEventListener("online", trigger);
    window.removeEventListener(SHARED_RETRY_EVENT, trigger); document.removeEventListener("visibilitychange", trigger); };
}
import type { SharedInvitationDestination } from "./SharedInvitationNotices";

type Props = { userId: string; language: string; writeEnabled: boolean; enabledCalendars: CalendarMode[]; experimentalTheme?: boolean; timeFormat?: TimeFormat;
  projectViewOrder: ProjectView[] | null; onProjectViewOrder: (views: ProjectView[]) => void;
  calendarScale: CalendarScale; onCalendarScale: (scale: CalendarScale) => void;
  inboxWidth: number; onInboxWidth: (width: number) => void; inboxPosition: InboxPosition; inboxHidden: boolean; inboxCompact: boolean; onInboxPosition: (position: InboxPosition) => void; onInboxHidden: (hidden: boolean) => void; onInboxCompact: (compact: boolean) => void;
  destination?: SharedInvitationDestination;
  categoriesExpanded: boolean; onCategoriesExpanded: (expanded: boolean) => void;
  categoriesView: "cards" | "list"; onCategoriesView: (view: "cards" | "list") => void;
  tasksCompact: boolean; onTasksCompact: (compact: boolean) => void;
  calendarMode: CalendarMode; taskCalendarMode: CalendarMode;
  onCalendarModeChange: (mode: CalendarMode) => Promise<void> };

const splitTags = (value: string) => [...new Set(value.split(/[,;\s]+/).map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean))];

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function SharedProjects({ userId, language, writeEnabled, enabledCalendars, calendarMode, taskCalendarMode, onCalendarModeChange, experimentalTheme = false, timeFormat = "24h", destination, inboxWidth, onInboxWidth, inboxPosition, inboxHidden, inboxCompact, onInboxPosition, onInboxHidden, onInboxCompact, categoriesExpanded, onCategoriesExpanded, categoriesView, onCategoriesView, projectViewOrder, onProjectViewOrder, calendarScale, onCalendarScale }: Props) {
  const english = language === "en";
  const sacredFeaturesEnabled = useSacredFeaturesEnabled();
  const tasksCompact = inboxCompact;
  const [initialPlace] = useState(() => {
    const route = typeof window === "undefined" ? null : sharedPlaceFromUrl(new URL(window.location.href));
    if (route) return route;
    if (destination) return { spaceId: destination.spaceId, projectId: destination.projectId || "", taskId: "", view: null };
    const saved = initialSharedPlace(userId);
    return projectViewOrder ? { ...saved, view: null } : saved;
  });
  const [requestedTaskId, setRequestedTaskId] = useState(initialPlace.taskId);
  const [commentId, setCommentId] = useState(initialPlace.commentId ?? "");
  const [locatedTaskId, setLocatedTaskId] = useState("");
  const locatedTaskApplied = useRef("");
  const initialRoute = useRef(true);
  const [trashOpen, setTrashOpen] = useState(false);
  const [taskArchiveOpen,setTaskArchiveOpen]=useState(false);
  const [workflowScope,setWorkflowScope]=useState<{id:string;title:string}|null>(null);
  const [savedViewsOpen,setSavedViewsOpen]=useState(false);
  const [undoTaskAction,setUndoTaskAction]=useState<{task:SharedTask;trash?:SharedTrashEntry}|null>(null);
  const [trashTarget,setTrashTarget]=useState<{kind:"task";task:SharedTask;context:SharedProjectSnapshot}|{kind:"project";project:SharedProject}|null>(null);
  const [mapsOpen, setMapsOpen] = useState(() => typeof window !== "undefined" && Boolean(new URL(location.href).searchParams.get("mindmap")));
  const [spaces, setSpaces] = useState<SharedSpace[]>([]);
  const [ownedProjectQuota,setOwnedProjectQuota]=useState<SharedProjectQuota>();
  const spacesRequest = useRef(0);
  const [spaceId, setSpaceId] = useState(initialPlace.spaceId);
  const [projectRows, setProjects] = useState<SharedProject[]>([]);
  const [projectMoves, setProjectMoves] = useState<Record<string,SharedProject>>({});
  const projects = useMemo(()=>projectRows.map(project=>{
    const preview=projectMoves[project.id];
    return preview && project.revision<=preview.revision ? preview : project;
  }),[projectRows,projectMoves]);
  const [archivedProjects, setArchivedProjects] = useState<SharedProject[]>([]);
  const [projectId, setProjectId] = useState(initialPlace.projectId);
  const projectIdRef = useRef(projectId);
  const spaceIdRef = useRef(spaceId);
  const [viewOverride, setViewOverride] = useState<"list" | "board" | "calendar" | "gantt" | null>(initialPlace.view);
  const [ganttDay, setGanttDay] = useState<string>();
  const [ganttReturnTarget, setGanttReturnTarget] = useState<GanttReturnTarget | null>(null);
  const [labels,setLabels] = useState<SharedLabel[]>([]);
  const [labelsOpen,setLabelsOpen] = useState(false);
  const [projectLabelIds,setProjectLabelIds] = useState<string[]>([]);
  const [editProjectLabelIds,setEditProjectLabelIds] = useState<string[]>([]);
  const [newTaskLabelIds,setNewTaskLabelIds] = useState<string[]>([]);
  const [editTaskLabelIds,setEditTaskLabelIds] = useState<string[]>([]);
  const [newPlan,setNewPlan] = useState(emptySharedPlan);
  const [editPlan,setEditPlan] = useState(emptySharedPlan);
  const [newTaskContext,setNewTaskContext] = useState<SharedProjectSnapshot|null>(null);
  const [newApprovalRequired, setNewApprovalRequired] = useState(false);
  const [newApproverIds, setNewApproverIds] = useState<string[]>([]);
  const [editApprovalRequired, setEditApprovalRequired] = useState(false);
  const [editApproverIds, setEditApproverIds] = useState<string[]>([]);
  const [approvalConfigChanged, setApprovalConfigChanged] = useState(false);
  const [newEntryType,setNewEntryType] = useState<EntryType>("task");
  const [editEntryType,setEditEntryType] = useState<EntryType>("task");
  const [activityKey,setActivityKey] = useState(0);
  const [calendarMonth, setCalendarMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12); });
  const [calendarDay, setCalendarDay] = useState(() => localDateKey(new Date()));
  const [calendarAgendaProjectId, setCalendarAgendaProjectId] = useState<string | null>(null);
  const [calendarTaskPicker, setCalendarTaskPicker] = useState(false);
  const [calendarTaskSearch, setCalendarTaskSearch] = useState("");
  const calendarAgendaRef = useRef<HTMLDialogElement>(null);
  const calendarTaskRequest = useRef(0);
  const [snapshotBase, setSnapshot] = useState<SharedProjectSnapshot | null>(null);
  const [priorityFilter, setPriorityFilter] = useState("");
  const [taskSort,setTaskSort]=useSharedTaskSort(userId);
  const [teamSnapshot, setTeamSnapshot] = useState<SharedProjectSnapshot | null>(null);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [uiReadySpace, setUiReadySpace] = useState("");
  const [invitations, setInvitations] = useState<SharedInvitation[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [createKind, setCreateKind] = useState<"project" | "task-list">("project");
  const [projectCategories, setProjectCategories] = useState<{ spaceId: string; items: import("./cloud-sync").SharedCategory[] }>({ spaceId: "", items: [] });
  const [projectCategoryId, setProjectCategoryId] = useState("");
  const [parentBoardId, setParentBoardId] = useState("");
  const [editingBoard, setEditingBoard] = useState<SharedStatus | null>(null);
  const [boardImage, setBoardImage] = useState("");
  const [completedPulse, setCompletedPulse] = useState(false);
  const { notice, announce } = useActionNotice();
  const uiSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [inboxPreviewBase, setInboxPreview] = useState<SharedProjectSnapshot | null>(null);
  const [optimisticMoves, setOptimisticMoves] = useState<Record<string, SharedTask>>({});
  const [retryMove, setRetryMove] = useState<{task:SharedTask;destinationProjectId:string;statusId:string;position?:number;schedule?:GanttTaskDates;nextView?:"list"|"board"}|null>(null);
  const inboxPreview = useMemo(() => sharedMovePreview(inboxPreviewBase, optimisticMoves), [inboxPreviewBase, optimisticMoves]);
  const [googleSettings, setGoogleSettings] = useState<SharedGoogleSettings | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleStatus, setGoogleStatus] = useState("");
  const [taskId, setTaskId] = useState("");
  const [taskEditing,setTaskEditing]=useState(false);
  const [previewProjectId,setPreviewProjectId]=useState("");
  const isCompact = useSyncExternalStore(subscribeCompact, compactSnapshot, serverCompactSnapshot);
  const isMobile = useMobileLayout();
  const [taskSection, setTaskSection] = useState<"task" | "comments">("task");
  const [taskSnapshot, setTaskSnapshot] = useState<SharedProjectSnapshot | null>(null);
  const [comments, setComments] = useState<SharedComment[]>([]);
  const [editingSpaceId, setEditingSpaceId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const searchMoreController = useRef<AbortController | null>(null);
  const [searchResults, setSearchResults] = useState<SharedAffairSearch>({ projects: [], tasks: [] });
  const [searchBusy, setSearchBusy] = useState(false);
  const [projectTags, setProjectTags] = useState<string[]>([]);
  const [newTaskTags, setNewTaskTags] = useState("");
  const [editTaskTags, setEditTaskTags] = useState("");
  const [editTaskDetails, setEditTaskDetails] = useState<SharedTaskDetailsDraft>({ priority: 0, parentTaskId: null, checklists: [] });
  const [editCustomFields,setEditCustomFields]=useState<CustomFieldValues>({});
  const [editEstimates,setEditEstimates]=useState<EstimateDraft>(()=>estimateDraft());
  const [newCustomFields,setNewCustomFields]=useState<CustomFieldValues>({});
  const [customFieldDraftOpen,setCustomFieldDraftOpen]=useState(false);
  const [templateScope,setTemplateScope]=useState<{context:SharedProjectSnapshot;source?:{taskId?:string;title:string}}|null>(null);
  const templateAccessLost=useCallback(()=>{setTemplateScope(null);announce(translateText("Нет доступа"));},[announce]);
  const [automationScope,setAutomationScope]=useState<SharedProjectSnapshot|null>(null);
  const automationAccessLost=useCallback(()=>{setAutomationScope(null);announce(translateText("Нет доступа"));},[announce]);
  const [dataScope,setDataScope]=useState<SharedProjectSnapshot|null>(null);
  const dataAccessLost=useCallback(()=>{setDataScope(null);announce(translateText("Нет доступа"));},[announce]);
  const [reportScope,setReportScope]=useState<{context:SharedProjectSnapshot;filter:import('./cloud-sync').SharedTaskFilter}|null>(null);
  const [planningScope,setPlanningScope]=useState<SharedProjectSnapshot|null>(null);
  const planningAccessLost=useCallback(()=>{setPlanningScope(null);announce(translateText('Нет доступа'));},[announce]);
  const reportAccessLost=useCallback(()=>{setReportScope(null);announce(translateText("Нет доступа"));},[announce]);
  const [customCriteria,setCustomCriteria]=useState<{projectId:string;criteria:CustomFieldCriterion[]}>({projectId:"",criteria:[]});
  const [customSort,setCustomSort]=useState<{projectId:string;sort:import("./cloud-sync").SharedTaskSort}>({projectId:"",sort:"position"});
  const [projectTitle, setProjectTitle] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [parentId, setParentId] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskFiles, setNewTaskFiles] = useState<TaskFileDraft[]>([]);
  const [newTaskImageReading, setNewTaskImageReading] = useState(false);
  const [editTaskFiles, setEditTaskFiles] = useState<TaskFileDraft[]>([]);
  const [removedTaskFileIds, setRemovedTaskFileIds] = useState<string[]>([]);
  const [editTaskFilesReading, setEditTaskFilesReading] = useState(false);
  const [newTaskCalendarMode, setNewTaskCalendarMode] = useState<CalendarMode>(taskCalendarMode);
  const [newTaskDestination, setNewTaskDestination] = useState<{ projectId: string; statusId?: string; title: string; isInbox: boolean } | null>(null);
  const [newTaskRootProjectId, setNewTaskRootProjectId] = useState("");
  const [editTaskCalendarMode, setEditTaskCalendarMode] = useState<CalendarMode>(taskCalendarMode);
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [newStatusTitle, setNewStatusTitle] = useState("");
  const [newStatusDone, setNewStatusDone] = useState(false);
  const [newStatusColor, setNewStatusColor] = useState("#2d6c68");
  const [statusDestinations, setStatusDestinations] = useState<Record<string, string>>({});
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDescription, setEditTaskDescription] = useState("");
  const [editTaskDueDate, setEditTaskDueDate] = useState("");
  const [editTaskCategoryId, setEditTaskCategoryId] = useState("");
  const [editTaskRevision, setEditTaskRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [readErrors, setReadErrors] = useState<Record<string, { key: string; message: string } | undefined>>({});
  const readError = readErrors.spaces?.message || (readErrors.projects?.key === spaceId ? readErrors.projects.message : "")
    || (readErrors.project?.key === projectId ? readErrors.project.message : "");
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const [pendingCreates, setPendingCreates] = useState<Awaited<ReturnType<typeof queuedSharedMutations>>>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const taskDialogRef = useRef<HTMLDialogElement>(null);
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const [createModal, setCreateModal] = useState<"space" | "space-settings" | "project" | "task" | "status" | "invite" | "join" | "settings" | "team" | "board" | null>(null);
  const [boardTitleEdit, setBoardTitleEdit] = useState<{ id: string; title: string } | null>(null);
  const cancelledBoardTitleRef = useRef(false);
  const activeView = viewOverride ?? defaultProjectView(projectViewOrder, isCompact, snapshotBase?.project.layout);
  const calendarData = sharedCalendarWindow(calendarMonth, calendarMode, calendarScale);
  const calendarWindow = { ...calendarData, periods: calendarData.periods.map(period => {
    const middle = period.dates[Math.floor(period.dates.length / 2)];
    const sacred = calendarMode === "sacred" ? getSacredDate(middle) : null, lunar = calendarMode === "lunar" ? getLunarDate(middle) : null;
    const title = calendarMode === "profane" ? new Intl.DateTimeFormat(language, { month: "long", year: "numeric" }).format(middle)
      : calendarMode === "sacred" ? `${translateText(MONTHS[sacred!.monthIndex].name, language as import("./i18n").Language)} · ${sacred!.sacredYear}–${sacred!.sacredYear + 1}`
        : `${translateText(lunar!.month.name, language as import("./i18n").Language)} · ${lunar!.year.sacredYear}–${lunar!.year.sacredYear + 1}`;
    return { ...period, title };
  }) };
  const calendarPeriod = calendarWindow.periods[0];
  const rangeFilter = activeView === "calendar" ? { from: calendarWindow.from, to: calendarWindow.to } : {};
  const projectCustomFilter=customCriteria.projectId===projectId&&customCriteria.criteria.length?{customFields:customCriteria.criteria}:{};
  const projectSort=customSort.projectId===projectId?customSort.sort:taskSort;
  const projectPage = useSharedTaskPage(projectId && activeView !== "gantt" ? { projectIds: [projectId], ...rangeFilter, ...(activeView === "calendar" ? {completion:"open" as const} : {}), ...(priorityFilter ? { priority: [Number(priorityFilter)] } : {}),...projectCustomFilter } : null, projectSort, activityKey);
  const appliedPriority = {...(priorityFilter ? {priority:[Number(priorityFilter)]} : {}),...projectCustomFilter};
  const calendarFrom = calendarWindow.from, calendarTo = calendarWindow.to;
  const calendarPreviews = useCalendarTaskPreviews(userId, calendarFrom, calendarTo, Boolean(projectId && activeView === "calendar"),
    {filter:{projectIds:[projectId],...appliedPriority},allWidths:true,refreshKey:activityKey,pollMs:5000});
  const calendarScopeKey = JSON.stringify([userId, spaceId, projectId, activeView, calendarFrom, calendarTo, appliedPriority]);
  useEffect(() => () => { calendarTaskRequest.current++; }, [calendarScopeKey]);
  const dayPage = useSharedTaskPage(projectId && calendarAgendaProjectId === projectId ? { projectIds: [projectId], dueFrom: calendarDay, dueTo: calendarDay, ...appliedPriority } : null, "position", activityKey);
  const undatedPage = useSharedTaskPage(projectId && activeView === "calendar" ? {projectIds:[projectId],undated:true,completion:"open",...appliedPriority} : null, projectSort, activityKey);
  const completedPage = useSharedTaskPage(projectId && activeView === "calendar" ? {projectIds:[projectId],...rangeFilter,completion:"completed",...appliedPriority} : null, projectSort, activityKey);
  const choicesPage = useSharedTaskPage(projectId && calendarTaskPicker ? {projectIds:[projectId],completion:"open",q:calendarTaskSearch} : null, "title", activityKey);
  const snapshot = useMemo(() => sharedMovePreview(snapshotBase && projectId === snapshotBase.project.id && activeView !== "gantt" ? { ...snapshotBase, tasks: projectPage.page?.tasks ?? [], taskPage: projectPage.page ?? undefined } : snapshotBase, optimisticMoves), [snapshotBase, projectPage.page, projectId, activeView, optimisticMoves]);
  const inboxProject = projects.find((project) => project.spaceId === spaceId && Boolean(project.isInbox));
  const inboxProjectId = inboxProject?.id;
  const taskProjectId = taskSnapshot?.project.id;
  const selectedTask = taskSnapshot?.tasks.find((task) => task.id === taskId);
  useSharedTaskRead(selectedTask && !selectedTask.pending ? taskProjectId : undefined, selectedTask?.id,
    taskSection === "comments" ? comments.map(comment => comment.id) : []);
  const [seriesDirty, setSeriesDirty] = useState(false);
  const taskFieldsSaved = Boolean(selectedTask && JSON.stringify(editTaskDetails) === JSON.stringify(taskDetailsDraft(selectedTask))
    && JSON.stringify(editCustomFields)===JSON.stringify(selectedTask.customFields??{})
    && (!taskSnapshot?.project.planning?.enabled||JSON.stringify(editEstimates)===JSON.stringify(estimateDraft(selectedTask)))
    && editTaskTitle === selectedTask.title && editTaskDescription === selectedTask.description
    && editTaskDueDate === (selectedTask.dueDate ?? "") && editTaskCategoryId === (selectedTask.categoryId ?? "")
    && editTaskTags === (selectedTask.tags ?? []).join(", ") && JSON.stringify(editPlan) === JSON.stringify(taskSharedPlan(selectedTask))
    && JSON.stringify(editTaskLabelIds) === JSON.stringify(selectedTask.labelIds ?? []) && editEntryType === (selectedTask.entryType ?? "task")
    && !approvalConfigChanged && !editTaskFiles.length && !removedTaskFileIds.length && !editTaskFilesReading);
  const taskDraftSaved = taskFieldsSaved && !seriesDirty;
  const taskOpen = Boolean(selectedTask);
  useEffect(()=>{if(!taskOpen||!taskEditing||taskFieldsSaved)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[taskOpen,taskEditing,taskFieldsSaved]);
  const closeTask = () => {
    setTaskEditing(false);setTaskId(""); setTaskSnapshot(null); setComments([]); setCommentId("");
  };
  const closeCreateModal=()=>{
    setCustomFieldDraftOpen(false);setCreateModal(null);setNewTaskDestination(null);setNewTaskRootProjectId("");
  };

  useEffect(() => {
    if (!spaceId) return;
    let live = true;
    void Promise.all([loadSharedUiState(spaceId), listSharedProjects(spaceId)]).then(([state, items]) => {
      if (!live) return;
      setExpandedIds(state.expandedIds); setUiReadySpace(spaceId);
      setProjectId(current => items.some(item => item.id === current) ? current : restoredSharedProject(items, state.expandedIds));
    }).catch((error: unknown) => {
      if (!live) return;
      setExpandedIds([]); setUiReadySpace(spaceId);
      setMessage(english ? "Could not load your saved layout. Try opening the workspace again."
        : "Не удалось загрузить сохранённый вид. Откройте пространство повторно.");
      console.error(error instanceof Error ? error.message : "Shared layout load failed");
    });
    return () => { live = false; };
  }, [spaceId, english]);

  const persistExpansion = (next: string[]) => {
    setExpandedIds(next);
    if (!writeEnabled) return;
    const target = spaceId;
    uiSaveQueue.current = uiSaveQueue.current.catch(() => undefined).then(() => saveSharedUiState(target, next))
      .catch(() => setMessage(english ? "Your layout was not saved. Check your connection."
        : "Положение разделов не сохранено. Проверьте подключение."));
  };
  const openJoin = () => {
    setCreateModal("join"); setInvitationsLoading(true);
    void listSharedInvitations().then(setInvitations).catch((error: unknown) => setMessage(String(error)))
      .finally(() => setInvitationsLoading(false));
  };

  useEffect(() => {
    if (!searchQuery.trim() || !spaceId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchBusy(true);
      void searchSharedAffairs(spaceId, searchQuery, controller.signal).then(result => {if(!controller.signal.aborted)setSearchResults(result);})
        .catch((error: unknown) => { if (!controller.signal.aborted) setMessage(String(error)); })
        .finally(() => { if (!controller.signal.aborted) setSearchBusy(false); });
    }, 150);
    return () => { controller.abort(); searchMoreController.current?.abort(); window.clearTimeout(timer); };
  }, [spaceId, searchQuery]);
  useEffect(() => { projectIdRef.current = projectId; }, [projectId]);
  useEffect(() => { spaceIdRef.current = spaceId; }, [spaceId]);
  useEffect(() => {
    const onOffline = () => setOffline(true);
    const onOnline = () => setOffline(false);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => { window.removeEventListener("offline", onOffline); window.removeEventListener("online", onOnline); };
  }, []);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      const ids = [...new Set([projectId, inboxProjectId].filter((id): id is string => Boolean(id)))];
      if (!ids.length) { setPendingCreates([]); return; }
      void Promise.all(ids.map(queuedSharedMutations)).then((items) => { if (live) setPendingCreates(items.flat()); })
        .catch(() => { if (live) setPendingCreates([]); });
    };
    refresh();
    window.addEventListener("genesis-shared-offline-change", refresh);
    return () => { live = false; window.removeEventListener("genesis-shared-offline-change", refresh); };
  }, [projectId, inboxProjectId]);

  useEffect(() => {
    const dialog = createDialogRef.current;
    if (!dialog) return;
    if (createModal && !dialog.open) dialog.showModal();
    if (!createModal && dialog.open) dialog.close();
  }, [createModal]);
  useEffect(() => {
    const dialog = taskDialogRef.current;
    if (!dialog) return;
    if (taskOpen && !dialog.open) dialog.showModal();
    if (!taskOpen && dialog.open) dialog.close();
  }, [taskOpen]);

  const refreshSpaces = useCallback(async (signal?: AbortSignal) => {
    const request = ++spacesRequest.current;
    const directory = await loadSharedSpaceDirectory(signal), items=directory.spaces;
    if (signal?.aborted || request !== spacesRequest.current) return;
    setOffline(sharedDataCameFromOfflineCache() || !navigator.onLine);
    setSpaces((current) => JSON.stringify(current) === JSON.stringify(items) ? current : items);
    setOwnedProjectQuota(directory.ownedProjectQuota);
    setSpaceId((current) => items.some((item) => item.id === current) ? current : "");
  }, []);
  const refreshProjects = useCallback(async (id: string, signal?: AbortSignal) => {
    const [items, archived, spaceLabels, categories] = await Promise.all([listSharedProjects(id, signal), listArchivedSharedProjects(id, signal), listSharedLabels(id, signal), listSharedProjectCategories(id, signal)]);
    if (signal?.aborted || spaceIdRef.current !== id) return;
    setOffline(sharedDataCameFromOfflineCache() || !navigator.onLine);
    setProjects((current) => JSON.stringify(current) === JSON.stringify(items) ? current : items);
    setArchivedProjects((current) => JSON.stringify(current) === JSON.stringify(archived) ? current : archived);
    setLabels(spaceLabels);
    setProjectCategories({ spaceId: id, items: categories });
    if (!items.length) setSnapshot(null);
    setProjectId((current) => items.some((item) => item.id === current && !item.isInbox) ? current : "");
  }, []);
  const refreshProject = useCallback(async (id: string, signal?: AbortSignal) => {
    try {
      const result = await loadSharedProject(id, undefined, null, "position", signal);
      if (signal?.aborted || projectIdRef.current !== id) return;
      setOffline(sharedDataCameFromOfflineCache() || !navigator.onLine);
      setSnapshot((current) => JSON.stringify(current) === JSON.stringify(result) ? current : result);
      if (result.project.isInbox) setInboxPreview(result);
    } catch(error) {
      if(projectIdRef.current===id && error && typeof error==="object" && "status" in error && [401,403,404].includes(Number(error.status))){
        setSnapshot(current=>current?.project.id===id?null:current);
        setTaskSnapshot(current=>current?.project.id===id?null:current);
        setTeamSnapshot(current=>current?.project.id===id?null:current);
        setInboxPreview(current=>current?.project.id===id?null:current);
        setProjects(current=>current.filter(project=>project.id!==id));
        setProjectId(current=>current===id?"":current);
      }
      throw error;
    }
  }, [setInboxPreview]);
  const refreshTaskProject = async (id: string) => {
    const [result, task] = await Promise.all([loadSharedProject(id), taskId ? loadSharedTask(id, taskId, true) : Promise.resolve(null)]);
    if (task) result.tasks = [...result.tasks.filter(item => item.id !== task.id), task];
    setTaskSnapshot((current) => current?.project.id === id ? result : current);
  };

  useEffect(() => {
    return watchSharedRead(refreshSpaces, () => setReadErrors(current => ({ ...current, spaces: undefined })),
      error => setReadErrors(current => ({ ...current, spaces: { key: userId, message: error instanceof Error ? error.message : String(error) } })),
      () => setLoading(false));
  }, [refreshSpaces, userId]);
  useEffect(() => {
    if (!spaceId) return;
    return watchSharedRead(signal => refreshProjects(spaceId, signal), () => setReadErrors(current => ({ ...current, projects: undefined })),
      error => setReadErrors(current => ({ ...current, projects: { key: spaceId, message: error instanceof Error ? error.message : String(error) } })));
  }, [spaceId, refreshProjects]);
  useEffect(() => {
    if (!projectId) return;
    return watchSharedRead(signal => refreshProject(projectId, signal), () => setReadErrors(current => ({ ...current, project: undefined })),
      error => setReadErrors(current => ({ ...current, project: { key: projectId, message: error instanceof Error ? error.message : String(error) } })));
  }, [projectId, refreshProject]);
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    const initial = window.setTimeout(() => {
      setGoogleSettings(null); setGoogleStatus("");
      void loadSharedGoogleSettings(projectId).then((settings) => {
        if (live) setGoogleSettings(settings);
      }).catch((error: unknown) => {
        if (live) setGoogleStatus(error instanceof Error ? error.message : String(error));
      });
    }, 0);
    return () => { live = false; window.clearTimeout(initial); };
  }, [projectId]);
  useEffect(() => {
    if (!projectId || !googleSettings?.tasksEnabled && !googleSettings?.calendarEnabled) return;
    let pending = false;
    const timer = window.setInterval(() => {
      if (!pending && document.visibilityState === "visible" && navigator.onLine) {
        pending = true;
        void syncSharedGoogle(projectId).catch(() => undefined).finally(() => { pending = false; });
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [projectId, googleSettings?.tasksEnabled, googleSettings?.calendarEnabled]);
  useEffect(() => {
    if (!taskProjectId || !taskId) return;
    let live = true;
    void listSharedComments(taskProjectId, taskId).then((items) => { if (live) setComments(items); })
      .catch((error: unknown) => { if (live) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { live = false; };
  }, [taskProjectId, taskId]);
  useEffect(() => {
    if (!taskProjectId || !taskId) return;
    let live = true;
    const refresh = () => {
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      void Promise.all([loadSharedProject(taskProjectId), loadSharedTask(taskProjectId, taskId, true)]).then(([result, task]) => {
        if (live) setTaskSnapshot({ ...result, tasks: [...result.tasks.filter(item => item.id !== task.id), task] });
      }).catch(error => { if(live && error && typeof error==="object" && "status" in error && [401,403,404].includes(Number(error.status))) {setTaskSnapshot(null);setTaskId("");setComments([]);setMessage(translateText("Эта задача больше недоступна."));} });
      void listSharedComments(taskProjectId,taskId).then(items=>{if(live)setComments(items);}).catch(()=>undefined);
    };
    const timer = window.setInterval(refresh, 5_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [taskProjectId, taskId]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try { await action(); setActivityKey(value=>value+1); }
    catch (error) { setMessage(error instanceof Error && error.message === "INVITEE_ACCOUNT_UNSUPPORTED"
      ? (english ? "This account cannot use shared projects." : "Этот аккаунт не может использовать общие проекты.")
      : error instanceof Error && error.message === "INVITEE_ACCOUNT_NOT_FOUND"
        ? (english ? "No GENESIS account was found for this email." : "Аккаунт GENESIS с такой почтой не найден.")
        : customFieldsError(error) ?? sharedTaskDetailsError(error) ?? taskFileError(error, english)); }
    finally { setBusy(false); }
  };
  const changeGoogle = (field: "tasksEnabled" | "calendarEnabled", enabled: boolean) => {
    if (!googleSettings || !projectId || googleBusy) return;
    const target = projectId;
    setGoogleBusy(true); setGoogleStatus("");
    void updateSharedGoogleSettings(target, {
      tasksEnabled: field === "tasksEnabled" ? enabled : googleSettings.tasksEnabled,
      calendarEnabled: field === "calendarEnabled" ? enabled : googleSettings.calendarEnabled,
    }).then(async (settings) => {
      if (projectIdRef.current !== target) return;
      setGoogleSettings(settings);
      if (enabled) {
        const result = await syncSharedGoogle(target);
        setGoogleStatus(english ? `Google copies updated: ${result.synced}.` : `Копии Google обновлены: ${result.synced}.`);
      } else setGoogleStatus(english ? "Sync is off. Existing Google copies remain in your account."
        : "Синхронизация выключена. Созданные копии остаются в вашем Google-аккаунте.");
    }).catch((error: unknown) => {
      if (projectIdRef.current === target) setGoogleStatus(error instanceof Error ? error.message : String(error));
    })
      .finally(() => setGoogleBusy(false));
  };
  const submitProject = (event: FormEvent) => {
    event.preventDefault();
    if (!spaceId) return;
    if (!sharedProjectQuotaAvailable(selectedSpace?.projectQuota,parentId)) return;
    void run(async () => {
      await createSharedProject(spaceId, {
        title: projectTitle, description: projectDescription, tags: projectTags, layout: "list",
        parentId: parentId || null, boardStatusId: parentBoardId || null, kind: createKind,
        labelIds: projectLabelIds,
        categoryId: createKind === "project" ? projectCategoryId || null : null,
      });
      setProjectTitle(""); setProjectDescription(""); setProjectTags([]); setParentId(""); setProjectLabelIds([]); setProjectCategoryId("");
      await refreshProjects(spaceId);
      await refreshSpaces();
      setProjectId(""); setSnapshot(null);
      setParentBoardId(""); setCreateKind("project");
      setCreateModal(null);
      setMessage(createKind === "task-list" ? (english ? "Task list created." : "Список задач создан.")
        : (english ? "Project created." : "Проект создан."));
    });
  };
  const submitTask = (event: FormEvent) => {
    event.preventDefault();
    if (!newTaskDestination || !newTaskTitle.trim() || newTaskImageReading) return;
    const destinationProjectId = newTaskDestination.projectId;
    if (!destinationProjectId) return;
    void run(async () => {
      const destination = await loadSharedProject(destinationProjectId);
      if (destination.project.isInbox) throw new Error(translateText("Выберите проект", language as import("./i18n").Language));
      if (newApprovalRequired && !newApproverIds.length) throw new Error(english ? "Select at least one participant." : "Выберите хотя бы одного участника.");
      const statusId = newTaskDestination.statusId ?? "";
      const created = await createSharedTask(destination.project.id, {
        ...(newTaskFiles.length ? { attachments: newTaskFiles.map(({ name, data }) => ({ name, data })) } : {}),
        title: newTaskTitle.trim(), description: newTaskDescription.trim(), tags: splitTags(newTaskTags),
        dueDate: newTaskDueDate || null,
        labelIds: newTaskLabelIds, startDate:newPlan.startDate||null, startTime:newPlan.startTime||null, endTime:newPlan.endTime||null, dependsOnIds:newPlan.dependsOnIds,
        statusId, categoryId: null, assigneeId: null,
        approvalRequired: newApprovalRequired, approverIds: newApproverIds,
        entryType: newEntryType,
        customFields:newCustomFields,
      });
      setNewTaskTitle(""); setNewTaskDescription(""); setNewTaskFiles([]); setNewTaskTags(""); setNewTaskDueDate("");setNewCustomFields({});
      window.dispatchEvent(new Event("genesis:shared-updates"));
      if (!created.pending) {
        if (newTaskDestination.isInbox) setInboxPreview(await loadSharedProject(destination.project.id));
        if (projectId === destination.project.id) await refreshProject(projectId);
        await refreshProjects(spaceId);
      }
      setCreateModal(null);
      setMessage(created.pending
        ? (english ? "Task saved on this device. It will reach the team when the connection returns."
          : "Задача сохранена на устройстве и появится у команды после подключения к сети.")
        : newTaskDestination.isInbox
          ? (english ? "Task added to the shared inbox." : "Задача добавлена в хаос-бокс.")
          : (english ? "Task added to the project." : "Задача добавлена в проект."));
    });
  };
  const moveTaskTo = (task: SharedTask, destinationProjectId: string, statusId = "", position?: number, schedule?:GanttTaskDates, nextView?:"list"|"board") => {
    if (busy) return;
    setOptimisticMoves(current=>({...current,[task.id]:{...task,...schedule,projectId:destinationProjectId,statusId,pending:true}}));
    const clearPreview = () => setOptimisticMoves(current=>{const next={...current};delete next[task.id];return next;});
    void run(async () => {
      let confirmed=false;
      try {
      const destination = destinationProjectId === snapshot?.project.id
        ? snapshot : await loadSharedProject(destinationProjectId);
      if (destination.project.isInbox) throw new Error(translateText("Выберите проект", language as import("./i18n").Language));
      const resolvedStatus = statusId;
      const moved = await moveSharedTask(task.projectId, task.id, {
        ...schedule,
        destinationProjectId, statusId: resolvedStatus, expectedRevision: task.revision,
        position: position ?? sharedTaskDropPosition(destination, task, resolvedStatus),
      });
      if (moved.pending) {
        if (nextView) setViewOverride(nextView);
        setMessage(english ? "Move saved on this device and waiting for the connection."
          : "Перенос сохранён на устройстве и ожидает подключения к сети.");
        return;
      }
      confirmed=true;
      setOptimisticMoves(current=>({...current,[task.id]:{...task,...moved}}));
      if (projectId) await refreshProject(projectId);
      await projectPage.refresh();
      await refreshProjects(spaceId);
      if (taskId === task.id) {
        const result = await loadSharedProject(destinationProjectId);
        result.tasks = [...result.tasks.filter(item=>item.id!==task.id),{...task,...moved}];
        setTaskSnapshot((current) => current?.tasks.some((item) => item.id === task.id) ? result : current);
        setEditTaskRevision(moved.revision); setEditTaskCategoryId(result.tasks.find((item) => item.id === task.id)?.categoryId ?? "");
      }
      const inbox = projects.find((project) => project.isInbox);
      if (inbox) setInboxPreview(await loadSharedProject(inbox.id));
      if (nextView) setViewOverride(nextView);
      setRetryMove(null);
      setMessage(english ? "Task moved." : "Задача перемещена.");
      } catch(error) {
        if(!confirmed){clearPreview();setRetryMove({task,destinationProjectId,statusId,position,schedule,nextView});}
        throw error;
      }
    });
  };
  const moveTask = (task: SharedTask, statusId: string) => {
    const context = task.projectId === snapshot?.project.id ? snapshot : taskSnapshot;
    if (!context || task.statusId === statusId) return;
    moveTaskTo(task, task.projectId, statusId,
      sharedTaskDropPosition(context, task, statusId));
  };
  const scheduleTask=(task:SharedTask,schedule:GanttSchedule)=>{
    if(busy||!snapshot)return;
    const target=snapshot;
    void run(async()=>{
      const changed=task.projectId===target.project.id
        ? await updateSharedTask(task.projectId,task.id,{...schedule,expectedRevision:task.revision})
        : await moveSharedTask(task.projectId,task.id,{...schedule,destinationProjectId:target.project.id,statusId:"",expectedRevision:task.revision,position:target.tasks.length});
      setSnapshot(current=>current?.project.id===target.project.id ? {...current,tasks:[...current.tasks.filter(item=>item.id!==task.id),{...task,...changed,...schedule,projectId:target.project.id}]} : current);
      if(changed.pending)setMessage(english ? "Schedule saved on this device and waiting for connection." : "Сроки сохранены на устройстве и ожидают подключения к сети.");
      else {await refreshProject(target.project.id);await refreshProjects(spaceId);}
    });
  };
  const returnGanttTask = (task:SharedTask, destination:GanttReturnTarget) => {
    const schedule = destination.unschedule ?? ganttUnscheduledSchedule(task, "days");
    if (destination.projectId !== task.projectId || destination.statusId && destination.statusId !== task.statusId) {
      moveTaskTo(task,destination.projectId,destination.statusId,destination.position,schedule,destination.view);
      return;
    }
    if (busy) return;
    void run(async () => {
      const changed = await updateSharedTask(task.projectId,task.id,{...schedule,expectedRevision:task.revision});
      setSnapshot(current => current?.project.id === task.projectId ? {...current,tasks:current.tasks.map(item=>item.id===task.id ? {...item,...changed,...schedule} : item)} : current);
      if (destination.view) setViewOverride(destination.view);
      if (!changed.pending) { await refreshProject(task.projectId); await refreshProjects(spaceId); }
      else setMessage(english ? "Schedule saved on this device and waiting for connection." : "Сроки сохранены на устройстве и ожидают подключения к сети.");
    });
  };
  const canDropOnProject = (item: SharedDragItem, target: SharedProject) => {
    if (target.isInbox) return false;
    if (item.kind === "task") {
      const source = snapshot?.project.id === item.task.projectId ? snapshot.project : projects.find(project => project.id === item.task.projectId);
      return !item.task.pending && Boolean(source?.canOrganizeTasks) && Boolean(target.canOrganizeTasks);
    }
    return (item.project.permissions?.manageProjects ?? ["owner", "manager"].includes(item.project.role))
      && (target.permissions?.editTasks ?? ["owner", "manager", "member"].includes(target.role));
  };
  const resolveSharedDrop = (x:number, y:number, item:SharedDragItem):SharedDropTarget | null => {
    if (busy) return null;
    const below = document.elementFromPoint(x, y);
    const unscheduled = below?.closest<HTMLElement>("[data-gantt-unscheduled]");
    const returnView = below?.closest<HTMLElement>("[data-shared-drop-view]")?.dataset.sharedDropView;
    if (snapshot && item.kind === "task" && (unscheduled || returnView === "list" || returnView === "board")
      && (snapshot.project.permissions?.editTasks ?? ["owner","manager","member"].includes(snapshot.project.role))) {
      return {projectId:snapshot.project.id,statusId:"",position:0,
        unschedule:ganttUnscheduledSchedule(item.task,unscheduled?.dataset.ganttUnscheduled as GanttScale || "days"),
        ...(returnView === "list" || returnView === "board" ? {view:returnView} : {})};
    }
    const axis=below?.closest<HTMLElement>("[data-gantt-axis]");
    if(axis&&snapshot&&item.kind==="task"&&(snapshot.project.permissions?.editTasks ?? ["owner","manager","member"].includes(snapshot.project.role))&&snapshot.project.canOrganizeTasks){
      const start=Number(axis.dataset.ganttStart),end=Number(axis.dataset.ganttEnd),scale=axis.dataset.ganttScale as GanttScale;
      const periods=JSON.parse(axis.closest<HTMLElement>('[data-gantt-periods]')?.dataset.ganttPeriods||'[]');
      const schedule=ganttSchedule(item.task,Math.max(start,Math.min(end-(scale==="day" ? 1/96 : 1),ganttAxisPoint(periods,x-axis.getBoundingClientRect().left))),scale);
      return {projectId:snapshot.project.id,statusId:"",position:0,schedule,ganttRow:axis.closest<HTMLElement>('[data-gantt-task]')?.dataset.ganttTask};
    }
    const calendarDate = below?.closest<HTMLElement>("[data-shared-calendar-date]")?.dataset.sharedCalendarDate;
    if (calendarDate && snapshot && item.kind === "task" && snapshot.project.canOrganizeTasks
      && (snapshot.project.permissions?.editTasks ?? ["owner", "manager", "member"].includes(snapshot.project.role))) {
      return { projectId: snapshot.project.id, statusId: "", position: 0, calendarDate,
        schedule: ganttSchedule(item.task, dateSerial(calendarDate), "days") };
    }
    const column = below?.closest<HTMLElement>("[data-shared-drop-status]");
    if (column && snapshot) {
      if (!canDropOnProject(item, snapshot.project)) return null;
      const statusId = column.dataset.sharedDropStatus ?? "";
      const hovered = below?.closest<HTMLElement>("[data-shared-task-id]");
      const after = Boolean(hovered && y >= hovered.getBoundingClientRect().top + hovered.getBoundingClientRect().height / 2);
      return { projectId: snapshot.project.id, statusId, position: item.kind === "task"
        ? sharedTaskDropPosition(snapshot, item.task, statusId, hovered?.dataset.sharedTaskId, after,
          !priorityFilter && !Object.keys(projectCustomFilter).length && (activeView === "board" || activeView === "list")) : 0 };
    }
    const projectId = below?.closest<HTMLElement>("[data-shared-drop-project]")?.dataset.sharedDropProject;
    const project = snapshot && snapshot.project.id === projectId ? snapshot.project : projects.find(row => row.id === projectId);
    return project && canDropOnProject(item, project) ? { projectId: project.id, statusId: "", position: 0 } : null;
  };
  const applySharedDrop = (item:SharedDragItem, destination:SharedDropTarget) => {
    if (!destination.projectId || busy) return;
    const targetProject = snapshot?.project.id === destination.projectId ? snapshot.project : projects.find(project => project.id === destination.projectId);
    if (!targetProject || (!destination.schedule && !destination.unschedule && !canDropOnProject(item, targetProject))) return;
    if (item.kind === "task") {
      if (destination.unschedule) { returnGanttTask(item.task,destination); return; }
      if(destination.schedule){
        if (destination.calendarDate) setCalendarDay(destination.calendarDate);
        scheduleTask(item.task,destination.schedule);return;
      }
      const currentStatus = snapshot?.project.id === item.task.projectId && isSharedInboxTask(item.task, snapshot.statuses) ? "" : item.task.statusId;
      if (destination.projectId !== item.task.projectId || destination.statusId !== currentStatus || destination.position !== item.task.position)
        moveTaskTo(item.task, destination.projectId, destination.statusId, destination.position);
    } else {
      const child = item.project;
      let parent = projects.find((project) => project.id === destination.projectId);
      const visited = new Set<string>();
      while (parent && !visited.has(parent.id)) {
        if (parent.id === child.id) return;
        visited.add(parent.id); parent = projects.find((project) => project.id === parent?.parentId);
      }
      setProjectMoves(current=>({...current,[child.id]:{...child,parentId:destination.projectId,boardStatusId:destination.statusId||null}}));
      const clear=()=>setProjectMoves(current=>{const next={...current};delete next[child.id];return next;});
      void run(async () => {
        let confirmed=false;
        try {
          const changed=await updateSharedProject(child.id, { title: child.title, description: child.description, tags: child.tags,
            layout: child.layout, parentId: destination.projectId, boardStatusId: destination.statusId || null, expectedRevision: child.revision });
          confirmed=true;setProjectMoves(current=>({...current,[child.id]:changed}));
          await refreshProjects(spaceId);await refreshSpaces();clear();
        } catch(error) {if(!confirmed)clear();throw error;}
      });
    }
  };
  const resolveGanttReturn = (x:number,y:number,task:SharedTask):GanttReturnTarget | null => {
    const target = resolveSharedDrop(x,y,{id:task.id,title:task.title,kind:"task",task});
    if (!target || target.schedule) return null;
    if ((target.projectId !== task.projectId || target.statusId && target.statusId !== task.statusId)
      && !snapshot?.project.canOrganizeTasks) return null;
    return target;
  };
  const sharedDrag = useAffairDrag<SharedDragItem, SharedDropTarget>(resolveSharedDrop,applySharedDrop);
  const dragPreview = sharedDrag.preview;
  const dropTarget:SharedDropTarget | null = sharedDrag.target ?? ganttReturnTarget;
  const assignTask = (task: SharedTask, assigneeId: string) => {
    void run(async () => {
      const changed = await updateSharedTask(task.projectId, task.id, {
        assigneeId: assigneeId || null, expectedRevision: task.revision,
      });
      if (changed.pending) setMessage(english ? "Change saved on this device."
        : "Изменение сохранено на устройстве и ожидает подключения к сети.");
      else {
        setEditTaskRevision(changed.revision);
        await refreshTaskProject(task.projectId);
        await refreshProject(task.projectId);
      }
    });
  };
  const submitInvite = (event: FormEvent) => {
    event.preventDefault(); if (!spaceId) return;
    void run(async () => {
      await inviteSharedSpaceMember(spaceId, inviteEmail, inviteRole === "viewer" ? "guest" : "member");
      setInviteEmail(""); setCreateModal(null);
      setMessage(english ? "Invitation is available in the recipient's GENESIS account." : "Приглашение появится в личном кабинете получателя GENESIS.");
    });
  };
  const submitComment = async (body:string,mentionIds:string[]) => {
    if (!taskProjectId || !taskId || busy) throw new Error("COMMENT_NOT_READY");
    setBusy(true);setMessage("");
    try { await addSharedComment(taskProjectId, taskId, body,mentionIds);setComments(await listSharedComments(taskProjectId,taskId));setActivityKey(value=>value+1); }
    catch(error){setMessage(english ? "Could not send the comment. Your draft is kept." : "Не удалось отправить комментарий. Черновик сохранён.");throw error;}
    finally{setBusy(false);}
  };
  const submitTaskEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!taskProjectId || !taskId || editTaskFilesReading) return;
    void run(async () => {
      const changed = await updateSharedTask(taskProjectId, taskId, {
        ...editTaskDetails,
        customFields:editCustomFields,
        ...(taskSnapshot?.project.planning?.enabled?estimateInput(editEstimates):{}),
        ...(editTaskFiles.length ? { attachments: editTaskFiles.map(({ name, data }) => ({ name, data })) } : {}),
        ...(removedTaskFileIds.length ? { removeAttachmentIds: removedTaskFileIds } : {}),
        title: editTaskTitle.trim(), description: editTaskDescription.trim(), tags: splitTags(editTaskTags),
        dueDate: editTaskDueDate || null, categoryId: editTaskCategoryId || null,
        labelIds:editTaskLabelIds,startDate:editPlan.startDate||null,startTime:editPlan.startTime||null,endTime:editPlan.endTime||null,dependsOnIds:editPlan.dependsOnIds,
        expectedRevision: editTaskRevision,
        entryType: editEntryType,
        ...(approvalConfigChanged ? { approvalRequired: editApprovalRequired, approverIds: editApproverIds } : {}),
      });
      setEditTaskRevision(changed.revision);
      setEditTaskDetails(taskDetailsDraft(changed));
      setEditCustomFields(changed.customFields??{});
      setEditEstimates(estimateDraft(changed));
      setEditTaskFiles([]); setRemovedTaskFileIds([]);
      setApprovalConfigChanged(false);
      if (!changed.pending) {
        await refreshTaskProject(taskProjectId);
        await refreshProject(taskProjectId);
        if (taskProjectId === inboxProjectId) setInboxPreview(await loadSharedProject(taskProjectId));
      }
      setMessage(changed.pending
        ? (english ? "Change saved on this device and waiting for the connection."
          : "Изменение сохранено на устройстве и ожидает подключения к сети.")
        : (english ? "Task saved." : "Задача сохранена."));
    });
  };
  const submitStatus = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!snapshot) return;
    void run(async () => {
      await createSharedStatus(snapshot.project.id, newStatusTitle.trim(), newStatusDone, undefined, newStatusColor);
      setNewStatusTitle(""); setNewStatusDone(false);
      await refreshProject(snapshot.project.id);
      await refreshProjects(spaceId);
      setCreateModal(null);
    });
  };

  const removeStatus = (statusId: string, revision: number, destinationId: string) => {
    if (!snapshot || !destinationId || !window.confirm(english
      ? "Remove this status and move its tasks to the selected status?"
      : "Удалить статус и перенести его задачи в выбранный статус?")) return;
    void run(async () => {
      await deleteSharedStatus(snapshot.project.id, statusId, destinationId, revision);
      await refreshProject(snapshot.project.id);
      await refreshProjects(spaceId);
    });
  };
  // Board names are stored user content, even when they match interface labels.
  const statusLabel = (title: string) => title;
  const submitProjectEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!snapshot) return;
    const fields = new FormData(event.currentTarget);
    const current = snapshot.project;
    void run(async () => {
      await updateSharedProject(current.id, {
        title: String(fields.get("title") ?? ""),
        description: String(fields.get("description") ?? ""), tags: JSON.parse(String(fields.get("tags") ?? "[]")),
        layout: snapshot.project.layout,
        parentId: String(fields.get("parentId") ?? "") || null,
        expectedRevision: current.revision,
        labelIds: editProjectLabelIds,
        categoryId: String(fields.get("categoryId") ?? "") || null,
      });
      await refreshProjects(current.spaceId);
      await refreshProject(current.id);
      await refreshSpaces();
      setMessage(english ? "Project updated." : "Проект обновлён.");
    });
  };
  const archiveProject = () => {
    if (!snapshot) return;
    setProjectToComplete(snapshot.project);
  };
  const [projectToComplete, setProjectToComplete] = useState<SharedProject | null>(null);
  const confirmProjectCompletion = () => {
    const current = projectToComplete;
    if (!current || busy) return;
    setProjectToComplete(null);
    void run(async () => {
      await setSharedProjectArchived(current.id, true);
      setCompletedPulse(true); setMessage(english ? "Project completed" : "Проект завершён");
      announce(english ? "Project completed" : "Проект завершён");
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      setCompletedPulse(false);
      persistExpansion(expandedIds.filter((id) => id !== current.id));
      setSnapshot(null); setTaskId("");
      await refreshProjects(current.spaceId);
      await refreshSpaces();
      setMessage(english ? "Project completed" : "Проект завершён");
    });
  };
  const restoreProject = (id: string) => {
    if (!spaceId) return;
    void run(async () => {
      await setSharedProjectArchived(id, false);
      await refreshProjects(spaceId);
      await refreshSpaces();
      setProjectId(id);
      persistExpansion([...new Set([...expandedIds, id])]);
      setMessage(english ? "Project restored." : "Проект восстановлен.");
    });
  };
  const setMemberRole = (memberId: string, role: string) => {
    if (!teamSnapshot) return;
    void run(async () => {
      await changeSharedMemberRole(teamSnapshot.project.id, memberId, role);
      setTeamSnapshot(await loadSharedProject(teamSnapshot.project.id));
    });
  };
  const removeMember = (memberId: string) => {
    if (!teamSnapshot || !window.confirm(english ? "Remove this participant?" : "Удалить этого участника?")) return;
    void run(async () => {
      await removeSharedMember(teamSnapshot.project.id, memberId);
      setTeamSnapshot(await loadSharedProject(teamSnapshot.project.id));
    });
  };
  const roleLabel = (role: string) => ({
    owner: english ? "Owner" : "Владелец", manager: english ? "Manager" : "Менеджер",
    member: english ? "Member" : "Участник", commenter: english ? "Commenter" : "Комментатор",
    viewer: english ? "Viewer" : "Читатель", admin: english ? "Admin" : "Администратор",
    guest: english ? "Guest" : "Гость",
  })[role as "owner" | "manager" | "member" | "commenter" | "viewer" | "admin" | "guest"] ?? role;
  const selectProject = (project: SharedProject) => {
    const expanded = expandedIds.includes(project.id);
    const collapse = expanded && projectId === project.id;
    const next = collapse ? expandedIds.filter((id) => id !== project.id) : [...new Set([...expandedIds, project.id])];
    persistExpansion(next);
    setProjectId(collapse ? "" : project.id);
    setSnapshot(null); setTaskId(""); setComments([]); setViewOverride(null);
  };
  const renderProjectTree = (parent: string | null, ancestors = new Set<string>()): ReactNode => {
    return projects.filter((project) => !project.isInbox && !ancestors.has(project.id) && (project.parentId === parent
      || parent === null && project.parentId && !projects.some((item) => item.id === project.parentId)))
      .map((project) => <div key={project.id} className="shared-tree-branch">
        <button type="button" className="shared-projects-project-link shared-affair-draggable" data-affair-drag-surface
          {...sharedDrag.props({ id: project.id, title: project.title, kind: "container", project }, !busy && (project.permissions?.manageProjects ?? ["owner", "manager"].includes(project.role)))} aria-expanded={expandedIds.includes(project.id)}
          data-shared-drop-project={project.id} aria-current={projectId === project.id ? "page" : undefined}
          onClick={() => {selectProject(project);setPreviewProjectId(project.id);}}>
          <svg viewBox="0 0 20 20" aria-hidden="true" className={expandedIds.includes(project.id) ? "is-expanded" : ""}><path d="m7 4 6 6-6 6"/></svg>
          <span>{project.title}<SharedLabelBadges labels={labels} ids={project.labelIds}/><small>{project.layout === "board"
            ? `${english ? "Boards" : "Доски"} · ${project.id === snapshot?.project.id ? snapshot.statuses.length : project.boardCount ?? 0}`
            : `${english ? "Tasks" : "Задачи"} · ${project.taskCount ?? 0}`}</small></span>
        </button>
        {expandedIds.includes(project.id) ? <div className="shared-tree-children">{renderProjectTree(project.id, new Set([...ancestors, project.id]))}</div> : null}
      </div>);
  };
  const openBoardSettings = (status: SharedStatus) => {
    setEditingBoard(status); setBoardImage(status.imageUrl ?? ""); setCreateModal("board");
  };
  const saveBoard = (status: SharedStatus, values: { title?: string; color?: string }) => {
    if (!snapshot || busy) return;
    const target = snapshot.project.id;
    void run(async () => {
      await updateSharedStatus(target, status.id, values.title ?? status.title, status.revision,
        values.color ? { color: values.color } : undefined);
      await refreshProject(target);
    });
  };
  const saveBoardTitle = (status: SharedStatus) => {
    const edit = boardTitleEdit;
    setBoardTitleEdit(null);
    if (cancelledBoardTitleRef.current || edit?.id !== status.id) return;
    const title = edit.title.trim();
    if (title && title !== statusLabel(status.title)) saveBoard(status, { title });
  };
  const placeContainer = (child: SharedProject, statusId: string) => applySharedDrop(
    { id: child.id, title: child.title, kind: "container", project: child }, { projectId, statusId, position: 0 });
  useEffect(() => {
    if (!inboxProjectId) return;
    let live = true;
    const refresh = () => void loadSharedProject(inboxProjectId).then((result) => {
      if (live) setInboxPreview(result);
    }).catch((error: unknown) => {
      if (live) {
        setMessage(error instanceof Error ? error.message : String(error));
        if(error && typeof error==="object" && "status" in error && [401,403,404].includes(Number(error.status)))setInboxPreview(null);
      }
    });
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [inboxProjectId]);
  const visibleInbox = inboxPreview && inboxPreview.project.id === inboxProjectId ? {...inboxPreview,tasks:[]} : null;
  const { active: activeCalendarTasks } = ganttTaskGroups(snapshot?.tasks ?? [], snapshot?.statuses ?? []);
  const completedCalendarTasks = completedPage.page?.tasks ?? [];
  const completedCalendarIds = new Set([...completedCalendarTasks,...dayPage.page?.tasks.filter(task=>task.completedAt) ?? []].map(task => task.id));
  const calendarTasks = (dayPage.page?.tasks ?? activeCalendarTasks.filter(task => task.dueDate === calendarDay)).filter(task => !task.completedAt);
  const completedDayTasks = (dayPage.page?.tasks ?? completedCalendarTasks.filter(task => task.dueDate === calendarDay)).filter(task => Boolean(task.completedAt));
  const calendarTaskChoices = choicesPage.page?.tasks ?? [];
  const undatedCalendarTasks = undatedPage.page?.tasks ?? [];
  const calendarAgendaOpen = Boolean(snapshot && activeView === "calendar" && calendarAgendaProjectId === snapshot.project.id);
  useEffect(() => {
    const dialog = calendarAgendaRef.current;
    if (!dialog) return;
    if (calendarAgendaOpen && !dialog.open) dialog.showModal();
    if (!calendarAgendaOpen && dialog.open) dialog.close();
  }, [calendarAgendaOpen]);
  const openTask = useCallback((task: SharedTask, context = snapshot, editing = false) => {
    calendarTaskRequest.current++;
    setTaskEditing(editing);
    if (!context || context.project.id !== task.projectId) return;
    setMessage("");
    setTaskSnapshot({ ...context, tasks: [...context.tasks.filter(item => item.id !== task.id), task] });
    setTaskSection("task");
    setCommentId("");
    setTaskId(task.id); setComments([]);
    setEditTaskCalendarMode(taskCalendarMode);
    setEditTaskFiles([]); setRemovedTaskFileIds([]);
    setEditTaskTitle(task.title); setEditTaskDescription(task.description); setEditTaskTags((task.tags ?? []).join(", "));
    setEditTaskDueDate(task.dueDate ?? ""); setEditTaskCategoryId(task.categoryId ?? "");
    setEditTaskRevision(task.revision);
    setEditTaskDetails(taskDetailsDraft(task));
    setEditCustomFields(structuredClone(task.customFields??{}));
    setEditEstimates(estimateDraft(task));
    setEditTaskLabelIds(task.labelIds||[]);setEditPlan(taskSharedPlan(task));
    setEditEntryType(task.entryType ?? "task");
    setEditApprovalRequired(Boolean(task.approvalRequired)); setEditApproverIds((task.approvals ?? []).flatMap(item => item.userId ? [item.userId] : [])); setApprovalConfigChanged(false);
  }, [snapshot, taskCalendarMode, setMessage, setTaskSnapshot, setTaskId, setComments, setEditTaskCalendarMode, setEditTaskTitle, setEditTaskDescription, setEditTaskTags, setEditTaskDueDate, setEditTaskCategoryId, setEditTaskRevision, setEditTaskLabelIds, setEditPlan, setEditTaskFiles, setRemovedTaskFileIds]);
  const openCalendarTask = async (preview: SharedCalendarTask) => {
    const request = ++calendarTaskRequest.current;
    try {
      const [context, task] = await Promise.all([loadSharedProject(preview.projectId), loadSharedTask(preview.projectId, preview.id)]);
      if (request !== calendarTaskRequest.current) return;
      setCalendarAgendaProjectId(null);
      openTask(task, context);
    } catch {
      if (request === calendarTaskRequest.current) setMessage(english ? "Could not open the task. Check your access and connection." : "Не удалось открыть задачу. Проверьте доступ и подключение.");
    }
  };
  useEffect(() => {
    const restore = () => {
      if (!window.location.hash.startsWith("#projects")) return;
      const place = sharedPlaceFromUrl(new URL(window.location.href)); if (!place) return;
      setSpaceId(place.spaceId); setProjectId(place.projectId); setViewOverride(place.view);
      setRequestedTaskId(place.taskId); setTaskId(""); setTaskSnapshot(null); setComments([]);
      setCommentId(place.commentId ?? "");
      locatedTaskApplied.current = "";
    };
    window.addEventListener("popstate", restore); window.addEventListener("genesis:shared-route", restore);
    return () => { window.removeEventListener("popstate", restore); window.removeEventListener("genesis:shared-route", restore); };
  }, []);
  useEffect(() => {
    if (!requestedTaskId || !projectId || uiReadySpace !== spaceId) return;
    let live = true;
    void Promise.all([loadSharedProject(projectId), loadSharedTask(projectId, requestedTaskId, true)]).then(([result, task]) => {
      if (!live) return;
      result.tasks = [...result.tasks.filter(item => item.id !== task.id), task];
      const place = sharedPlaceFromUrl(new URL(window.location.href));
      setSnapshot(result); setViewOverride(result.project.layout);
      setExpandedIds(ids => [...new Set([...ids, projectId])]);
      if (task && place?.taskAction === "locate") {
        setLocatedTaskId(task.id);
      } else if (task) {
        openTask(task, result);
        if (place?.taskAction === "comments") { setTaskSection("comments"); setCommentId(place.commentId ?? ""); }
      }
      else setMessage(english ? "This task is no longer available." : "Эта задача больше недоступна.");
      setRequestedTaskId("");
    }).catch(() => { if (live) { setMessage(english ? "Could not open the task. Check your access and connection." : "Не удалось открыть задачу. Проверьте доступ и подключение."); setRequestedTaskId(""); } });
    return () => { live = false; };
  }, [requestedTaskId, projectId, spaceId, uiReadySpace, openTask, english]);
  useEffect(() => {
    if (!locatedTaskId || !snapshot || locatedTaskApplied.current === locatedTaskId) return;
    const frame = window.requestAnimationFrame(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>("[data-shared-task-id]")).find(item => item.dataset.sharedTaskId === locatedTaskId);
      if(row)locatedTaskApplied.current = locatedTaskId;
      row?.scrollIntoView({ block: "center", behavior: "auto" }); row?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [locatedTaskId, snapshot]);
  useEffect(() => {
    if (loading || requestedTaskId || (spaceId && uiReadySpace !== spaceId)) return;
    if (!window.location.hash.startsWith("#projects")) return;
    recordSharedPlace(userId, { spaceId, projectId: taskId ? taskSnapshot?.project.id ?? projectId : projectId, taskId, view: viewOverride,
      ...(taskId && taskSection === "comments" ? { taskAction: "comments", ...(commentId ? { commentId } : {}) } : {}) }, initialRoute.current);
    initialRoute.current = false;
  }, [userId, spaceId, projectId, taskId, taskSnapshot?.project.id, viewOverride, loading, requestedTaskId, uiReadySpace, taskSection, commentId]);
  const canWrite = snapshot && (snapshot.project.permissions?.editTasks ?? ["owner", "manager", "member"].includes(snapshot.project.role));
  const canInvite = snapshot && (snapshot.project.permissions?.inviteMembers ?? ["owner", "manager"].includes(snapshot.project.role));
  const canManage = snapshot && (snapshot.project.permissions?.manageProjects ?? ["owner", "manager"].includes(snapshot.project.role));
  const canEditTask = !selectedTask?.archivedAt && taskSnapshot && (taskSnapshot.project.permissions?.editTasks ?? ["owner", "manager", "member"].includes(taskSnapshot.project.role));
  const canCommentTask = !selectedTask?.archivedAt && taskSnapshot && (taskSnapshot.project.permissions?.comment ?? ["owner", "manager", "member", "commenter"].includes(taskSnapshot.project.role));
  const selectedSpace=spaces.find(space=>space.id===spaceId);
  const confirmTask = (task: SharedTask) => {
    if (busy) return;
    void run(async () => {
      const result = await approveSharedTask(task.projectId, task.id);
      setEditTaskRevision(result.revision);
      await refreshTaskProject(task.projectId); await refreshProject(task.projectId); await refreshProjects(spaceId);
      if (task.projectId === inboxProjectId) setInboxPreview(await loadSharedProject(task.projectId));
      window.dispatchEvent(new Event("genesis:shared-updates"));
      setMessage(result.completedAt ? (english ? "Task completed." : "Задача завершена.") : (english ? "Your confirmation is saved. Waiting for the other participants." : "Ваше подтверждение сохранено. Ожидаем остальных участников."));
    });
  };
  const removeTask = (task:SharedTask,context:SharedProjectSnapshot) => {
    if(!busy&&context.project.canOrganizeTasks)setTrashTarget({kind:"task",task,context});
  };
  const renderTaskActions = (task: SharedTask, context: SharedProjectSnapshot) => <div className="shared-task-actions" onPointerDown={event => event.stopPropagation()}>
    {(context.project.permissions?.editTasks ?? ["owner", "manager", "member"].includes(context.project.role)) ? <button type="button" disabled={busy || task.pending}
      title={translateText("Редактировать задачу")} aria-label={`${translateText("Редактировать задачу")} «${task.title}»`}
      onClick={() => openTask(task, context, true)}><ExperimentalIcon name="edit" /></button> : null}
    {context.project.canOrganizeTasks ? <button type="button" className="shared-task-delete-icon" disabled={busy || task.pending}
      title={translateText("Удалить задачу")} aria-label={`${translateText("Удалить задачу")} «${task.title}»`}
      onClick={() => removeTask(task, context)}><ExperimentalIcon name="close" /></button> : null}
  </div>;
  const renderBoardTask = (task: SharedTask, status: SharedStatus) => {
    if (!snapshot) return null;
    return <article key={task.id}
            className={`shared-projects-task shared-affair-draggable${locatedTaskId === task.id ? " task-location-highlight" : ""}`} data-shared-task-id={task.id} data-unread-comments={task.unreadCommentCount??0} data-task-display={tasksCompact ? "compact" : "detailed"}
            {...sharedDrag.props({ id: task.id, title: task.title, kind: "task", task }, !busy && !task.pending && Boolean(snapshot.project.canOrganizeTasks))}>

            <div className="shared-task-card-title">
            <input type="checkbox" className="shared-task-complete" checked={Boolean(status.isDone) || Boolean(task.approvalRequired && task.approvals?.some(item => item.userId === userId && item.approvedAt))} disabled={busy||task.pending||(task.approvalRequired && !status.isDone ? !task.approvals?.some(item => item.userId === userId && !item.approvedAt) : !snapshot.project.canOrganizeTasks||!snapshot.statuses.some(item=>Boolean(item.isDone)!==Boolean(status.isDone)))}
              data-no-translate aria-label={`${translateText(status.isDone ? "Вернуть в работу задачу" : "Выполнить задачу",language as import("./i18n").Language)} «${task.title}»`}
              onChange={()=>{if(task.approvalRequired && !status.isDone){confirmTask(task);return;}const target=snapshot.statuses.find(item=>Boolean(item.isDone)!==Boolean(status.isDone));if(!status.id)moveTask(task,`chaos-${task.completedAt ? "open" : "done"}:${task.projectId}`);else if(target)moveTask(task,target.id);}}/>
            <SharedBoardTaskTitle key={`${task.id}:${boardDisplay(status).titleLines}`} title={task.title} lines={activeView === "board" ? boardDisplay(status).titleLines : 0} english={english} selected={taskId === task.id} onOpen={() => openTask(task)}>{task.tags?.length ? <em data-no-translate>{task.tags.map((tag) => `#${tag}`).join(" ")}</em> : null}<small>{task.dueDate ? formatCalendarDate(new Date(`${task.dueDate}T12:00:00`), calendarMode) : (english ? "No due date" : "Без срока")}</small>
            {task.unreadCommentCount?<span className="unread-comment-badge">{english?"Unread comments":"Новые комментарии"}: {task.unreadCommentCount}</span>:null}</SharedBoardTaskTitle>
            {task.priority ? <span className="shared-priority">{sharedPriorityLabel(task.priority)}</span> : null}
            </div><SharedLabelBadges labels={labels} ids={task.labelIds}/>
            {!tasksCompact ? <SharedTaskDetails task={task} context={snapshot} language={language as import("./i18n").Language}/> : null}
            {task.entryType && task.entryType !== "task" ? <small className="entry-type-badge">{entryTypeLabel(task.entryType,english)}</small> : null}
            <SharedCustomFieldValues fields={snapshot.customFieldDefinitions??[]} values={task.customFields??{}} language={language as import("./i18n").Language} mode={calendarMode} list/>
            {task.approvalRequired ? <small className="shared-task-approval-progress">{english ? "Confirmations" : "Подтверждения"}: {task.approvals?.filter(item => item.approvedAt).length ?? 0}/{task.approvals?.length ?? 0}</small> : null}
            {task.completedBy ? <small>{english ? "Completed by" : "Выполнил(а)"}: {snapshot.members.find((member) => member.userId === task.completedBy)?.displayName ?? (english ? "Former member" : "Бывший участник")}</small> : null}
            <SharedTaskReview task={task} userId={userId} onChanged={async()=>{await refreshProject(task.projectId);}}/>
            <div className="shared-task-card-controls">
            {activeView !== "board" && snapshot.project.canOrganizeTasks ? <select aria-label={english ? "Status" : "Статус"} value={snapshot.statuses.some(row => row.id === task.statusId) ? task.statusId : ""} disabled={busy} onChange={(event) => moveTask(task, event.target.value)}>
              <option value="">{english ? "Project inbox" : "Хаос-бокс проекта"}</option>
              {snapshot.statuses.map((item) => <option key={item.id} value={item.id} data-no-translate>{statusLabel(item.title)}</option>)}
            </select> : null}
            {renderTaskActions(task, snapshot)}
            </div>
          </article>;
  };
  const renderBoardContainer = (child: SharedProject) => {
    if (!snapshot) return null;
    const item: SharedDragItem = { id: child.id, title: child.title, kind: "container", project: child };
    const canMove = canDropOnProject(item, snapshot.project);
    return <article className={`shared-board-container shared-affair-draggable shared-kind-${child.kind ?? "project"}`} key={child.id}
      data-shared-container-id={child.id} {...sharedDrag.props(item, !busy && canMove)}>
      <button type="button" data-affair-drag-surface onClick={() => { setPreviewProjectId(child.id); setProjectId(child.id); setSnapshot(null); persistExpansion([...new Set([...expandedIds, child.id])]); }}>
        <small>{child.kind === "task-list" ? (english ? "Task list" : "Список задач") : (english ? "Project" : "Проект")}</small>
        <strong className={child.kind === "task-list" ? "task-list-entry-title" : undefined} data-no-translate>{child.title}</strong>
        <span className={child.kind === "task-list" ? "task-list-entry-meta" : undefined}>{child.taskCount ?? 0} {english ? "tasks" : "задач"}</span>
        <SharedLabelBadges labels={labels} ids={child.labelIds}/>
      </button>
      {canMove ? <label>{english ? "Board" : "Доска"}<select data-no-translate disabled={busy} value={child.boardStatusId ?? ""}
        aria-label={formatTranslatedText("Доска для «{title}»", language as import("./i18n").Language, { title: child.title })} onChange={event => placeContainer(child, event.target.value)}>
        <option value="">{translateText("Хаос-бокс проекта", language as import("./i18n").Language)}</option>
        {snapshot.statuses.map(board => <option key={board.id} value={board.id} data-no-translate>{statusLabel(board.title)}</option>)}
      </select></label> : null}
    </article>;
  };
  const projectInboxTasks = snapshot?.tasks.filter(task => isSharedInboxTask(task, snapshot.statuses)) ?? [];
  const projectInboxChildren = snapshot ? projects.filter(child => child.parentId === snapshot.project.id && !child.boardStatusId) : [];
  const canManageLabels=selectedSpace && (selectedSpace.permissions?.manageProjects ?? ["owner","admin"].includes(selectedSpace.role));
  const projectCategorySection = <SharedProjectCategories key={spaceId} spaceId={spaceId}
    categories={projectCategories.spaceId === spaceId ? projectCategories.items : []} projects={projects}
    canManage={Boolean(canManageLabels)} english={english}
    expanded={categoriesExpanded} onExpanded={onCategoriesExpanded}
    view={categoriesView} onView={onCategoriesView}
    onChanged={async () => { await refreshProjects(spaceId); if (snapshot) await refreshProject(snapshot.project.id); }}
    onOpen={project => { setPreviewProjectId(project.id); setProjectId(project.id); setSnapshot(null); persistExpansion([...new Set([...expandedIds, project.id])]); }} />;
  const taskDestinationIds = new Set(newTaskRootProjectId ? [newTaskRootProjectId] : []);
  for (let count = -1; count !== taskDestinationIds.size;) {
    count = taskDestinationIds.size;
    projects.forEach(project => { if (project.parentId && taskDestinationIds.has(project.parentId)) taskDestinationIds.add(project.id); });
  }
  const taskDestinationProjects = sharedProjectTree(projects.filter(project => taskDestinationIds.has(project.id)));
  const openCreateTask = (project: SharedProject, status?: SharedStatus, kind: "task" | "task-list" | "meeting" | "event" = "task", chooseProject = false) => {
    if (project.isInbox) return;
    setNewTaskFiles([]);
    setNewApprovalRequired(false); setNewApproverIds([]);
    setNewEntryType(kind === "meeting" || kind === "event" ? kind : "task");
    setNewTaskRootProjectId(chooseProject ? project.id : "");
    setNewTaskDestination({ projectId: project.id, statusId: status?.id,
      title: project.isInbox ? `${english ? "Workspace inbox" : "Хаос-бокс пространства"}: ${selectedSpace?.title ?? ""}` : status ? `${project.title} · ${statusLabel(status.title)}` : project.title, isInbox: Boolean(project.isInbox) });
    setNewTaskCalendarMode(taskCalendarMode);
    setNewPlan(emptySharedPlan());setNewTaskLabelIds([]);setNewTaskDueDate("");setNewTaskTitle("");setNewTaskDescription("");setNewTaskTags("");setNewCustomFields({});
    setNewTaskContext(null);void loadSharedProject(project.id).then(setNewTaskContext).catch(()=>undefined);
    setProjectTitle(""); setProjectDescription(""); setProjectTags([]); setProjectLabelIds([]); setProjectCategoryId("");
    setCreateKind("task-list"); setParentId(project.isInbox ? "" : project.id); setParentBoardId(status?.id ?? "");
    setCreateModal(kind === "task-list" ? "project" : "task");
  };
  const renderCalendarDate = (date: Date) => {
    const key = localDateKey(date);
    const isToday = key === localDateKey(new Date());
    const dayTasks = calendarPreviews?.tasks.filter(task => task.dueDate === key) ?? [];
    const count = calendarPreviews ? calendarPreviews.dateCounts[key] ?? 0 : snapshot?.taskPage?.dateCounts[key] ?? 0;
    const dateLabel = `${formatCalendarDate(date, calendarMode, true)}${isToday ? english ? " · Today" : " · Сегодня" : ""}${count ? english ? ` · ${count} tasks` : ` · задач: ${count}` : ""}`;
    const openDay = () => { calendarTaskRequest.current++; setCalendarDay(key); setCalendarTaskPicker(false); setCalendarAgendaProjectId(snapshot?.project.id ?? null); };
    const dayNumber = calendarMode === "sacred" ? getSacredDate(date).day
      : calendarMode === "lunar" ? getLunarDate(date).day : date.getDate();
    return <div key={key} role="group" aria-label={dateLabel} className="shared-projects-calendar-date"
      data-weekday={calendarMode === "profane" ? date.getDay() : undefined}
      data-solar={calendarMode === "profane" && sacredFeaturesEnabled && (() => { const info = getSacredDate(date); return Boolean(getSolarEvent(info.sacredYear, info.monthIndex, info.day)); })() || undefined}
      data-shared-calendar-date={key} data-drop-active={dropTarget?.calendarDate === key || undefined}
      data-has-tasks={count > 0 || undefined} data-weekend={calendarMode === "profane" ? date.getDay() === 6 ? "saturday" : date.getDay() === 0 ? "sunday" : undefined : undefined}
      data-selected={key === calendarDay || undefined} aria-current={isToday ? "date" : undefined}
      data-calendar-date={key}>
      <button type="button" className="shared-projects-calendar-date-open" aria-haspopup="dialog" aria-label={dateLabel} onClick={openDay}>
      <span className={`shared-calendar-day-number${isToday ? " shared-calendar-today-pill" : ""}`}>{dayNumber}</span>
      {calendarMode !== "profane" ? <time dateTime={key}>{formatGregorian(date)}</time> : null}
      </button>
      {calendarScale !== 0.25 ? <CalendarCellTasks personal={[]} shared={dayTasks} sharedTotal={count} dateLabel={formatCalendarDate(date, calendarMode, true)}
        previewLimit={calendarScale === 0.5 ? 1 : 3} language={language as import("./i18n").Language} onPersonal={() => undefined} onShared={task => void openCalendarTask(task)} onMore={openDay}/> : null}
      {count ? <small className="shared-calendar-task-count" aria-hidden="true">{count}</small> : null}
    </div>;
  };
  const renderCalendarPeriod = (period: ReturnType<typeof sharedCalendarPeriod>) => {
    const offset = (period.dates[0].getDay() + 6) % 7;
    const calendarDays = [...Array.from({ length: offset }, () => null), ...period.dates];
    return calendarMode === "profane" ? <div className="shared-projects-calendar-grid">
          {(english ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]).map((day, index) => <span key={day} className="shared-projects-calendar-weekday" data-weekend={index === 5 ? "saturday" : index === 6 ? "sunday" : undefined}>{day}</span>)}
          {calendarDays.map((date, index) => {
            if (!date) return <span key={`space-${index}`} aria-hidden="true" />;
            return renderCalendarDate(date);
          })}
        </div> : calendarMode === "sacred" ? <div className="shared-projects-calendar-cycles mode-sacred">
          {getSacredDate(period.dates[0]).monthIndex !== 12 ? <div className="shared-projects-calendar-elements" aria-hidden="true">
            {ELEMENTS.map((element) => <span key={element.name}>{translateText(element.name, language as import("./i18n").Language)}</span>)}
          </div> : null}
          {Array.from(new Set(period.dates.map((date) => {
            const sacred = getSacredDate(date);
            return getSacredDay(sacred.monthIndex, sacred.day).pyata;
          }))).map((pyata) => {
            const dates = period.dates.filter((date) => {
              const sacred = getSacredDate(date);
              return getSacredDay(sacred.monthIndex, sacred.day).pyata === pyata;
            });
            const sacred = getSacredDate(dates[0]);
            const firstDay = getSacredDay(sacred.monthIndex, sacred.day);
            return <section className="shared-projects-calendar-cycle" key={pyata} aria-label={pyata ? `${english ? "Quinta" : "Пята"} ${pyata}` : english ? "Apeiron" : "Апейрон"}>
              <header><strong>{pyata ? `${english ? "Quinta" : "Пята"} ${pyata}` : english ? "Outside time" : "Вне времени"}</strong>
                <span>{translateText(firstDay.pyataTitle || "Апейрон", language as import("./i18n").Language)}</span></header>
              <div className="shared-projects-cycle-days">{dates.map(renderCalendarDate)}</div>
            </section>;
          })}
        </div> : <div className="shared-projects-calendar-cycles mode-lunar">
          {LUNAR_DECADES.map((decade) => <section className="shared-projects-calendar-cycle" key={decade.id}
            aria-label={translateText(decade.name, language as import("./i18n").Language)}>
            <header><strong>{translateText(decade.name, language as import("./i18n").Language)}</strong><span>{translateText(decade.range, language as import("./i18n").Language)}</span></header>
            <div className="shared-projects-cycle-days">{period.dates.filter((date) => getLunarDate(date).decade.id === decade.id).map(renderCalendarDate)}</div>
          </section>)}
        </div>;
  };
  const renderCalendarTask = (task: SharedTask) => snapshot ? <article key={task.id} className={`shared-calendar-task${completedCalendarIds.has(task.id) ? " is-completed" : ""}`}
    style={{ "--shared-task-status-color": snapshot.statuses.find(status => status.id === task.statusId)?.color ?? "#2d6c68" } as CSSProperties}
    {...sharedDrag.props({ id: task.id, title: task.title, kind: "task", task }, !completedCalendarIds.has(task.id) && !busy && Boolean(snapshot.project.canOrganizeTasks) && Boolean(canWrite))}>
    <button type="button" className="shared-calendar-task-open" data-affair-drag-surface onClick={() => openTask(task)}>
      {task.priority ? <span className="shared-priority">{sharedPriorityLabel(task.priority)}</span> : null}
      <strong data-no-translate>{task.title}</strong>
      {task.entryType && task.entryType !== "task" ? <span className="entry-type-badge">{entryTypeLabel(task.entryType,english)}</span> : null}
      <span className="shared-calendar-task-status" data-no-translate>{statusLabel(snapshot.statuses.find((status) => status.id === task.statusId)?.title ?? "")}</span>
      {task.startTime ? <span>{formatTimeValue(task.startTime, timeFormat)}{task.endTime ? ` — ${formatTimeValue(task.endTime, timeFormat)}` : ""}</span> : null}
    </button>
    {renderTaskActions(task, snapshot)}
  </article> : null;

  if (sharedMindmapsEnabled && mapsOpen && selectedSpace && uiReadySpace === spaceId) return <Suspense fallback={<p role="status">Открываем зашифрованные карты…</p>}><SharedMindmaps
    afterWorkspace={<SharedSpaceCollaboration key={spaceId} userId={userId} spaceId={spaceId} language={language} writeEnabled={writeEnabled}/>}
    userId={userId} space={selectedSpace} projects={projects} projectId={projectId} language={language} enabledCalendars={enabledCalendars} timeFormat={timeFormat}
    onClose={() => { setMapsOpen(false); const url=new URL(location.href); url.searchParams.delete("mindmap"); history.replaceState(history.state,"",url); }}
    onTask={(task,context)=>{setMapsOpen(false);openTask(task,context);}}
    onProject={(id,calendar)=>{setMapsOpen(false);setProjectId(id);setSnapshot(null);setViewOverride(calendar?"calendar":null);}}/></Suspense>;
  const spacePicker = <select className="shared-space-picker" data-no-translate title={selectedSpace?.title} aria-label={translateText("Текущее пространство",language as import('./i18n').Language)} value={spaceId} onChange={event => {
        setSpaceId(event.target.value); setProjects([]); setProjectId(""); setSnapshot(null); closeTask();
      }}><option value="">{translateText("Выберите пространство",language as import('./i18n').Language)}</option>
        {spaces.map(space => <option key={space.id} value={space.id} data-no-translate>{space.title}</option>)}
      </select>;
  const spaceActions = (messagesButton: ReactNode) => <div className="shared-workspace-tools">
      <button type="button" className="secondary-button" title={translateText("Сохранённые представления")} aria-label={translateText("Сохранённые представления")} aria-haspopup="dialog" onClick={()=>setSavedViewsOpen(true)}><ExperimentalIcon name="list"/></button>
      {["owner", "admin"].includes(selectedSpace?.role ?? "") ? <button type="button" className="secondary-button" title={english ? "Workspace settings" : "Настройки пространства"} aria-label={english ? "Workspace settings" : "Настройки пространства"}
        onClick={() => { setEditingSpaceId(spaceId); setCreateModal("space-settings"); }}><ExperimentalIcon name="gear" /></button> : null}
      {canManageLabels ? <button type="button" className="secondary-button" title={english ? "Labels" : "Метки"} aria-label={english ? "Labels" : "Метки"} onClick={() => setLabelsOpen(true)}><ExperimentalIcon name="tag" /></button> : null}
      {spaceId ? <button type="button" className="secondary-button" disabled={busy || !inboxProject} title={english ? "Team and invitations" : "Команда и приглашения"} aria-label={english ? "Team and invitations" : "Команда и приглашения"}
        onClick={() => void run(async () => { if (inboxProject) setTeamSnapshot(await loadSharedProject(inboxProject.id)); setCreateModal("team"); })}><ExperimentalIcon name="team" /></button> : null}
      <button type="button" className="secondary-button" title={english ? "All workspaces" : "Все пространства"} aria-label={english ? "All workspaces" : "Все пространства"}
        onClick={() => { setSpaceId(""); setProjectId(""); setSnapshot(null); closeTask(); }}><ExperimentalIcon name="spaces" /></button>
      <button type="button" className="secondary-button" disabled={!sharedProjectQuotaAvailable(ownedProjectQuota)} title={english ? "Create workspace" : "Создать пространство"} aria-label={english ? "Create workspace" : "Создать пространство"} onClick={() => {if(sharedProjectQuotaAvailable(ownedProjectQuota))setCreateModal("space");}}><ExperimentalIcon name="space-plus" /></button>
      {messagesButton}
      </div>;
  const taskProjectChoice = taskEditing && selectedTask && taskSnapshot && !selectedTask.archivedAt && taskSnapshot.project.canOrganizeTasks ?
    <label>{english ? "Project" : "Проект"}<select value={taskSnapshot.project.id} disabled={busy}
      onChange={event => moveTaskTo(selectedTask, event.target.value)}>
      {sharedProjectTree(projects).map(({project, depth}) => <option key={project.id} value={project.id} data-no-translate>
        {depth ? `${"\u00a0\u00a0".repeat(depth)}↳ ` : ""}{project.title} · {formatTaskCount(project.taskCount ?? 0, language as import("./i18n").Language)}</option>)}
    </select></label> : null;
  const createTaskAction = canWrite && snapshot && !snapshot.project.isInbox ? <div className="shared-projects-create-actions">
    <button type="button" className="shared-projects-open-modal primary-button" aria-label={english ? "Create task" : "Создать задачу"} title={english ? "Create task" : "Создать задачу"} onClick={() => openCreateTask(snapshot.project, undefined, "task", true)}>
      <ExperimentalIcon name="plus" /><span className="shared-create-full">{english ? "Create task" : "Создать задачу"}</span><span className="shared-create-short">{english ? "Task" : "Задача"}</span>
    </button>
  </div> : null;
  return <div className="shared-projects" data-exp-layout="view" style={{
    "--shared-workspace-tool-count": 4 + Number(["owner", "admin"].includes(selectedSpace?.role ?? "")) + Number(canManageLabels) + Number(Boolean(spaceId)),
  } as CSSProperties}>
    <WorkspaceHeader title={english ? "Affairs · shared" : "Дела · общие"}
      overviewLabel={english ? "Workspace overview" : "Обзор пространства"}
      context={selectedSpace ? <SharedWorkspaceIdentity key={spaceId} title={selectedSpace.title} selector={spacePicker}
        owner={selectedSpace?.ownerName ?? visibleInbox?.members.filter(member => member.spaceRole === "owner").map(member => member.displayName).join(", ") ?? ""}
        members={selectedSpace?.memberCount ?? visibleInbox?.members.length}
        description={selectedSpace?.description} english={english} /> : undefined}
      mark={<ProjectsHeroMark shared />} description={english
        ? "Plan together while keeping personal tasks, habits and calendars private."
        : "Планируйте вместе. Личные задачи, привычки и календарь остаются вашими."}>
      <SharedWorkspaceSummary userId={userId} english={english} language={language} workspaceActions={selectedSpace ? spaceActions : undefined} onOpen={place => {
        void refreshSpaces();
        recordSharedPlace(userId, { ...place, taskId: place.taskId || "", view: null });
        window.dispatchEvent(new Event("genesis:shared-route"));
      }} />
    </WorkspaceHeader>
    <p className="shared-project-quota" data-project-quota>
      {(billingFeatureCopy[language as keyof typeof billingFeatureCopy]??billingFeatureCopy.en).sharedProjectPool}
      {(selectedSpace?.projectQuota??ownedProjectQuota)?.limit!=null?<strong> · {(selectedSpace?.projectQuota??ownedProjectQuota)!.count} / {(selectedSpace?.projectQuota??ownedProjectQuota)!.limit}</strong>:null}
    </p>
    {selectedSpace ? <section className="shared-workspace-toolbar shared-toolbar-projects-first" aria-label={english ? "Projects in workspace" : "Проекты пространства"}>
      {spaceId ? <div className="shared-project-toolbar-group" role="group" aria-label={english ? "Projects in workspace" : "Проекты пространства"}>
        <span className="shared-toolbar-label">{translateText("Проекты")}</span>
        {sharedMindmapsEnabled && selectedSpace ? <MindmapLaunchButton label={translateText("Майндмепы")} className="shared-mindmaps-open" onClick={()=>{closeTask();setSearchQuery("");setMapsOpen(true);}} /> : null}
        {projects.some(project => !project.isInbox) ? <select value={projectId} aria-label={english ? "Current project" : "Текущий проект"} onChange={event => {
          setProjectId(event.target.value); setSnapshot(null); closeTask(); setViewOverride(null);
          if (event.target.value) persistExpansion([...new Set([...expandedIds, event.target.value])]);
        }}><option value="">{english ? "Choose a project" : "Выберите проект"}</option>
          {sharedProjectTree(projects).map(({ project, depth }) => <option value={project.id} key={project.id} data-no-translate>
            {depth ? `${"\u00a0\u00a0".repeat(depth)}↳ ` : ""}{project.title} · {formatTaskCount(project.taskCount ?? 0, language as import("./i18n").Language)}
          </option>)}
        </select> : null}
        <div className="shared-project-toolbar-actions">{selectedSpace && (selectedSpace.permissions?.createProjects ?? selectedSpace.role !== "guest") ? <button type="button"
          className={projects.some(project => !project.isInbox) ? "secondary-button shared-create-project" : "primary-button shared-create-first-project"}
          title={english ? "Create project" : "Создать проект"}
          aria-label={projects.some(project => !project.isInbox) ? english ? "Create project" : "Создать проект" : english ? "Create your first project" : "Создать первый проект"}
          onClick={() => { setCreateKind("project"); setParentId(""); setParentBoardId(""); setCreateModal("project"); }}><ExperimentalIcon name="project-plus" />
          {!projects.some(project => !project.isInbox) ? english ? "Create project" : "Создать проект" : null}</button> : null}
        {selectedSpace ? <button type="button" className="secondary-button shared-trash-open" aria-label="Корзина" title="Корзина" onClick={()=>setTrashOpen(true)}><ExperimentalIcon name="delete"/></button> : null}
        {selectedSpace ? <button type="button" className="secondary-button shared-archive-open" aria-label={translateText("Архив задач")} title={translateText("Архив задач")} onClick={()=>setTaskArchiveOpen(true)}><ExperimentalIcon name="archive"/></button> : null}</div>
        <SharedTaskViewControls
          sorting={!projectId?<label className="task-order-choice"><span>{english?"Sort tasks":"Сортировка задач"}</span><select value={taskSort} onChange={event=>setTaskSort(event.target.value as import("./cloud-sync").SharedTaskSort)}>{([["position","Обычный порядок","Default order"],["createdAt","Новые вверху","Newest first"],["createdAtAsc","Старые вверху","Oldest first"],["dueDate","Ближайший срок","Due date"],["updatedAt","Последние изменения","Recently updated"],["title","По названию","Title"]] as const).map(([value,ru,en])=><option value={value} key={value}>{english?en:ru}</option>)}</select></label>:null}
          search={<label className="tag-search personal-affairs-search shared-workspace-search"><span aria-hidden="true">{experimentalTheme ? <ExperimentalIcon name="search" /> : "⌕"}</span><input type="search" aria-label={english ? "Find tasks and projects by title or tag" : "Поиск задач и проектов по названию или #тегу"} value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setSearchBusy(Boolean(event.target.value.trim())); setSearchResults({ projects: [], tasks: [] }); }} placeholder={english ? "Find tasks and projects by title or #tag" : "Поиск задач и проектов по названию или #тегу"} /></label>}
        />
      </div> : null}

    </section> : null}
    {templateScope?<Suspense fallback={<p role="status">{translateText("Загрузка…")}</p>}><SharedTemplates key={`${templateScope.context.project.id}:${templateScope.source?.taskId??"library"}`} userId={userId} spaceId={templateScope.context.project.spaceId} projectId={templateScope.context.project.id} language={language as import("./i18n").Language} mode={taskCalendarMode} timeFormat={timeFormat} canWrite={templateScope.context.project.permissions?.editTasks??["owner","manager","member"].includes(templateScope.context.project.role)} canCreateProjects={Boolean(templateScope.context.project.permissions?.createProjects)} canCaptureProject={!templateScope.context.project.isInbox} source={templateScope.source} projects={projects.filter(project=>!project.isInbox).map(project=>({id:project.id,title:project.title,canWrite:project.permissions?.editTasks??["owner","manager","member"].includes(project.role)}))} members={templateScope.context.members.map(member=>({id:member.userId,title:member.displayName}))} onClose={()=>setTemplateScope(null)} onAccessLost={templateAccessLost} onApplied={async receipt=>{await refreshSpaces();await refreshProjects(templateScope.context.project.spaceId);await refreshProject(receipt.rootProjectId);setSpaceId(templateScope.context.project.spaceId);setProjectId(receipt.rootProjectId);setTemplateScope(null);}}/></Suspense>:null}
    {automationScope?<Suspense fallback={<p role="status">{translateText("Загрузка…")}</p>}><SharedAutomations key={automationScope.project.id} snapshot={snapshot?.project.id===automationScope.project.id?snapshot:automationScope} labels={labels} userId={userId} language={language as import("./i18n").Language} mode={taskCalendarMode} timeFormat={timeFormat} onClose={()=>setAutomationScope(null)} onAccessLost={automationAccessLost} onChanged={()=>refreshProject(automationScope.project.id)} onOpenTask={task=>openTask(task)}/></Suspense>:null}
    {dataScope?<Suspense fallback={<p role="status">{translateText("Загрузка…")}</p>}><SharedDataExchange key={dataScope.project.id} snapshot={dataScope} userId={userId} language={language as import("./i18n").Language} mode={taskCalendarMode} onClose={()=>setDataScope(null)} onAccessLost={dataAccessLost} onChanged={async()=>{await refreshSpaces();await refreshProjects(dataScope.project.spaceId);if(projectId)await refreshProject(projectId);}} onOpenProject={id=>{setDataScope(null);setSpaceId(dataScope.project.spaceId);setProjectId(id);void refreshProject(id);}}/></Suspense>:null}
    {reportScope?<Suspense fallback={<p role="status">{translateText("Загрузка…")}</p>}><SharedTeamReports key={reportScope.context.project.id} snapshot={reportScope.context} initialFilter={reportScope.filter} language={language as import('./i18n').Language} mode={calendarMode} onClose={()=>setReportScope(null)} onAccessLost={reportAccessLost} onOpenTask={async task=>{const[context,fresh]=await Promise.all([loadSharedProject(task.projectId),loadSharedTask(task.projectId,task.id,Boolean(task.archivedAt))]);setReportScope(null);openTask(fresh,context);}}/></Suspense>:null}
    {planningScope?<Suspense fallback={<p role="status">{translateText('Загрузка…')}</p>}><SharedPlanning key={`${userId}:${planningScope.project.id}`} userId={userId} context={planningScope} language={language as import('./i18n').Language} mode={taskCalendarMode} onClose={()=>setPlanningScope(null)} onAccessLost={planningAccessLost} onChanged={async()=>{await refreshProject(planningScope.project.id);window.dispatchEvent(new Event('genesis:shared-updates'));}} onOpenTask={async task=>{const [context,fresh]=await Promise.all([loadSharedProject(task.projectId),loadSharedTask(task.projectId,task.id,Boolean(task.archivedAt))]);setPlanningScope(null);openTask(fresh,context);}}/></Suspense>:null}
    <Suspense fallback={<p role="status">{translateText("Загружаем данные…")}</p>}><SharedSavedViews key={userId} userId={userId} spaces={spaces} mode={calendarMode} inputMode={taskCalendarMode} opened={savedViewsOpen} onClose={()=>setSavedViewsOpen(false)} onOpen={task=>void run(async()=>{
      const [context,found]=await Promise.all([loadSharedProject(task.projectId),loadSharedTask(task.projectId,task.id,Boolean(task.archivedAt))]);setSavedViewsOpen(false);openTask(found,context);
    })}/></Suspense>
    {taskArchiveOpen && selectedSpace ? <SharedArchivedTasks spaceId={spaceId} projects={projects} onWorkflow={setWorkflowScope} onOpen={task=>void run(async()=>{const context=await loadSharedProject(task.projectId);setTaskArchiveOpen(false);openTask(task,context);})} onClose={()=>setTaskArchiveOpen(false)} onChanged={async()=>{await refreshProjects(spaceId);if(projectId)await refreshProject(projectId);window.dispatchEvent(new Event("genesis:shared-updates"));}} onTrash={task=>void run(async()=>{const context=await loadSharedProject(task.projectId);setTaskArchiveOpen(false);setTrashTarget({kind:"task",task,context});})}/> : null}
    {undoTaskAction ? <div className="shared-detail-actions" role="status"><span>{translateText("Действие выполнено. Вы можете его отменить.")}</span><button type="button" disabled={busy} onClick={()=>void run(async()=>{
      if(undoTaskAction.trash)await restoreSharedTrash(undoTaskAction.task.spaceId ?? spaceId,undoTaskAction.trash);else await setSharedTaskArchived(undoTaskAction.task,false);
      setUndoTaskAction(null);await refreshProjects(spaceId);if(projectId)await refreshProject(projectId);window.dispatchEvent(new Event("genesis:shared-updates"));
    })}>{translateText("Отменить действие")}</button></div> : null}
    {trashOpen && selectedSpace ? <SharedTrash spaceId={spaceId} onWorkflow={setWorkflowScope} onClose={()=>setTrashOpen(false)} onChanged={async()=>{await refreshSpaces();await refreshProjects(spaceId);if(projectId)await refreshProject(projectId);}}/> : null}
    {workflowScope?<Suspense fallback={<p role="status">{translateText('Загрузка…')}</p>}><SharedWorkflowDialog key={`${userId}:${workflowScope.id}`} userId={userId} project={workflowScope} language={language as import('./i18n').Language} onClose={()=>setWorkflowScope(null)} onChanged={async()=>{window.dispatchEvent(new Event('genesis:shared-updates'));}}/></Suspense>:null}
    {trashTarget ? <SharedTrashConfirmation title={trashTarget.kind==="task"?trashTarget.task.title:trashTarget.project.title} onClose={()=>setTrashTarget(null)} onConfirm={async days=>{
      if(trashTarget.kind==="task") {const {task,context}=trashTarget;const deleted=await deleteSharedTask(context.project.id,task.id,task.revision,days);setUndoTaskAction({task,trash:{kind:"task",id:task.id,title:task.title,deletedAt:new Date().toISOString(),expiresAt:deleted.expiresAt,retentionDays:days,canRestore:true,projectId:task.projectId}});if(taskId===task.id)closeTask();await refreshProject(context.project.id);if(context.project.isInbox)setInboxPreview(await loadSharedProject(context.project.id));}
      else {await trashSharedProject(trashTarget.project,days);await refreshSpaces();setProjectId("");setSnapshot(null);setCreateModal(null);closeTask();}
      await refreshProjects(spaceId);window.dispatchEvent(new Event("genesis:shared-updates"));
    }}/> : null}
    <ActionNotice message={notice}/>
    {projectToComplete ? <ProjectCompletionDialog fileRetentionWarning title={projectToComplete.title} onCancel={() => setProjectToComplete(null)} onConfirm={confirmProjectCompletion} /> : null}
    {message ? <p className="shared-projects-message" role="status">{message}</p> : null}
    {message && retryMove ? <button type="button" disabled={busy} onClick={()=>moveTaskTo(retryMove.task,retryMove.destinationProjectId,retryMove.statusId,retryMove.position,retryMove.schedule,retryMove.nextView)}>{translateText('Повторить')}</button> : null}
    {readError ? <div className="shared-projects-message shared-projects-read-error" role="status"><span>{readError}</span>
      <IconActionButton icon="map-refresh" label={translateText("Повторить")} onClick={() => window.dispatchEvent(new Event(SHARED_RETRY_EVENT))}/></div> : null}
    {offline ? <p className="shared-projects-offline-status" role="status">{english
      ? "Offline: showing the last protected team snapshot. Changes may be out of date."
      : "Нет связи: показана последняя защищённая копия команды. Данные могут устареть."}</p> : null}
    {pendingCreates.length ? <section className="shared-projects-pending" aria-label={english ? "Pending team tasks" : "Задачи в очереди отправки"}>
      <strong>{english ? "Waiting to send" : "Ожидают отправки"} · {pendingCreates.length}</strong>
      {pendingCreates.map((item) => <div className="shared-projects-pending-item" key={item.requestId}>
        <p>{item.kind === "move" ? (english ? "Move" : "Перенос")
          : item.kind === "update" ? (english ? "Edit" : "Изменение")
            : (english ? "New task" : "Новая задача")}: {item.title}{item.error
          ? ` · ${english ? "Needs attention" : "Нужна проверка"}: ${item.error}` : ""}</p>
        {item.error && item.draft ? <details><summary>{english ? "View saved draft" : "Посмотреть сохранённый черновик"}</summary>
          <pre>{item.draft}</pre><button type="button" onClick={() => {
            if (!window.confirm(english
              ? "Remove this local draft? This will not undo any change already on the server."
              : "Удалить этот локальный черновик? Уже внесённые на сервере изменения останутся.")) return;
            void discardSharedMutation(item.requestId).catch((error) => setMessage(String(error)));
          }}>{english ? "Remove local draft" : "Удалить локальный черновик"}</button></details> : null}
      </div>)}
    </section> : null}
    {loading ? <p role="status">{english ? "Loading projects…" : "Загружаем проекты…"}</p> : null}

    {searchQuery.trim() ? <section className="tag-search-results" aria-label="Результаты поиска дел" aria-live="polite" aria-busy={searchBusy}>
      <header><strong>{english ? "Search results" : "Результаты поиска"}</strong><span>{searchResults.projects.length} проектов · {searchResults.tasks.length} задач</span></header>
      <div>{searchResults.projects.filter((project) => !project.isInbox).map((project) => <button type="button" key={project.id} onClick={() => { setSearchQuery(""); setProjectId(project.id); setSnapshot(null); }}><span>Проект</span><strong>{project.title}</strong><small>{project.tags?.map((tag) => `#${tag}`).join(" ")}</small></button>)}
        {searchResults.tasks.map((task) => <button type="button" key={task.id} onClick={() => void run(async () => {
          const [result, found] = await Promise.all([loadSharedProject(task.projectId), loadSharedTask(task.projectId, task.id)]);
          openTask(found, result);
        })}><span>Задача · {task.projectTitle}</span><strong>{task.title}</strong><small>{task.tags.map((tag) => `#${tag}`).join(" ")}</small></button>)}</div>
      {!searchBusy && !searchResults.projects.length && !searchResults.tasks.length ? <p>{english ? "No matches" : "Совпадений нет"}</p> : null}
      <p>{translateText("Показано: {loaded} из {total}").replace("{loaded}", String(searchResults.tasks.length)).replace("{total}", String(searchResults.total ?? searchResults.tasks.length))}</p>
      {searchResults.hasMore ? <button type="button" disabled={searchBusy || busy} onClick={() => void run(async () => {
        const controller=new AbortController();searchMoreController.current=controller;
        try {
          const page = await searchSharedAffairs(spaceId, searchQuery, controller.signal, searchResults.nextCursor);
          if(controller.signal.aborted)return;
          setSearchResults({ ...page, tasks: [...searchResults.tasks, ...page.tasks] });
        } catch(error) {
          if(controller.signal.aborted)return;
          if(error instanceof Error && error.message === "SHARED_QUERY_CHANGED") {const page=await searchSharedAffairs(spaceId,searchQuery,controller.signal);if(!controller.signal.aborted)setSearchResults(page);}
          throw error;
        }
      })}>{translateText("Показать ещё")}</button> : null}
    </section> : null}
    {!spaceId ? <section className="shared-space-entry" aria-label={english ? "Shared workspaces" : "Общие пространства"}>
      {loading ? <p role="status">{english ? "Loading…" : "Загрузка…"}</p> : <>
        {spaces.length ? <div className="shared-space-list">{spaces.map((space) => <article className={`shared-space-card${space.coverUrl ? " has-cover" : ""}`} key={space.id}><button type="button" className="shared-space-open"
          onClick={() => { setSpaceId(space.id); setProjectId(""); setSnapshot(null); }}>
          {space.coverUrl ? <SharedSpaceCover src={space.coverUrl} position={space.coverPosition}/> : null}
          <span className="shared-space-caption"><strong>{space.title}</strong>{space.description ? <span className="shared-space-description">{space.description}</span> : null}<small>{roleLabel(space.role)}</small></span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
        </button>
          {["owner", "admin"].includes(space.role) ? <button type="button" className="shared-space-edit secondary-button"
            aria-label={english ? `Edit workspace “${space.title}”` : `Редактировать пространство «${space.title}»`}
            onClick={() => { setEditingSpaceId(space.id); setCreateModal("space-settings"); }}>{english ? "Settings" : "Настройки"}</button> : null}
        </article>)}</div> : null}
        <div className="shared-space-entry-actions">
          <button type="button" className="primary-button" disabled={!sharedProjectQuotaAvailable(ownedProjectQuota)} onClick={() => {if(sharedProjectQuotaAvailable(ownedProjectQuota))setCreateModal("space");}}>{english ? "Create workspace" : "Создать пространство"}</button>
          <button type="button" className="secondary-button" onClick={openJoin}>{english ? "Join workspace" : "Присоединиться к пространству"}</button>
        </div>
      </>}
    </section> : null}
    <div className="shared-projects-shell" hidden={!spaceId} data-inbox-workspace data-inbox-hidden="true">
    <main className="shared-projects-main">

    {snapshot && snapshot.project.id === projectId ? <>
      <div className="shared-project-workspace">
      <header className="shared-projects-context" data-shared-drop-project={snapshot.project.id} data-drop-active={dropTarget?.projectId === snapshot.project.id && !dropTarget.statusId || undefined}>
        <div className="shared-project-heading">
          {!snapshot.project.isInbox && snapshot.project.role === "owner" ? <button type="button" className={`project-complete-action${completedPulse ? " is-completing" : ""}`} disabled={busy} onClick={archiveProject} title={translateText("Завершить проект")} aria-label={`${translateText("Завершить проект")} «${snapshot.project.title}»`}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/></svg></button> : null}
          <h2>{snapshot.project.isInbox ? (english ? "Team tasks" : "Задачи команды") : snapshot.project.title}</h2>
        </div>
      <div className="shared-context-actions">
        {!snapshot.project.isInbox&&snapshot.project.kind!=='task-list'?<IconActionButton icon="mail" label={messengerText('project',language)} data-project-chat-trigger onClick={()=>window.dispatchEvent(new CustomEvent('genesis:messenger-project',{detail:{projectId:snapshot.project.id}}))}/>:null}
        {!snapshot.project.isInbox?<IconActionButton icon="list" label={planningText('heading',language as import('./i18n').Language)} data-planning-trigger onClick={()=>setPlanningScope(snapshot)}/>:null}
        <IconActionButton icon="copy" label={translateText("Шаблоны",language as import('./i18n').Language)} data-template-trigger onClick={()=>setTemplateScope({context:snapshot})}/>
        <IconActionButton icon="automation" label={translateText("Автоматизации",language as import('./i18n').Language)} data-automation-trigger onClick={()=>setAutomationScope(snapshot)}/>
        <IconActionButton icon="map-import" label={translateText("Импорт и экспорт",language as import('./i18n').Language)} data-exchange-trigger onClick={()=>setDataScope(snapshot)}/>
        <IconActionButton icon="history" label={translateText("Командный отчёт",language as import('./i18n').Language)} data-report-trigger onClick={()=>setReportScope({context:snapshot,filter:{projectIds:[snapshot.project.id],...rangeFilter,...appliedPriority}})}/>
        {(canManage || canInvite) && !snapshot.project.isInbox ? <IconActionButton icon="gear" label={translateText("Настройки проекта",language as import('./i18n').Language)} className="shared-project-settings-icon" onClick={() => {setEditProjectLabelIds(snapshot.project.labelIds||[]);setCreateModal("settings");}}/> : null}
      </div>
        <div className="shared-project-details">
          {!snapshot.project.isInbox && snapshot.project.description ? <p>{snapshot.project.description}</p> : null}
          <SharedLabelBadges labels={labels} ids={snapshot.project.labelIds}/>
        </div>
      </header>
      {projects.some(project => project.parentId === snapshot.project.id) ? <nav className="shared-current-subprojects" aria-label={english ? "Subprojects" : "Подпроекты"}>{renderProjectTree(snapshot.project.id)}</nav> : null}
      <section className="shared-projects-task-panel" aria-labelledby="shared-projects-tasks-title">
      <section className="shared-projects-planning" aria-label={english ? "Tasks and views" : "Задачи и виды проекта"}>
        <div className="shared-project-task-panel-heading"><h3 id="shared-projects-tasks-title">{english ? "Tasks" : "Задачи"}</h3>
        {isMobile ? createTaskAction : null}
      <div className="shared-task-query-bar" data-active-view={activeView}>
        {isCompact && !isMobile ? createTaskAction : null}
        <label aria-hidden={activeView === "gantt"}>{translateText("Приоритет")}<select disabled={activeView === "gantt"} value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)}><option value="">{translateText("Все приоритеты")}</option>{[0,1,2,3].map(priority => <option key={priority} value={priority}>{sharedPriorityLabel(priority)}</option>)}</select></label>
        <label aria-hidden={activeView === "gantt"}>{translateText("Сортировка")}<select disabled={activeView === "gantt"} value={projectSort} onChange={event=>{const sort=event.target.value as import("./cloud-sync").SharedTaskSort;if(sort.startsWith('custom:'))setCustomSort({projectId,sort});else{setCustomSort({projectId:"",sort:"position"});setTaskSort(sort);}}}>{([ ["position","Порядок на доске"],["priority","Приоритет"],["dueDate","Срок"],["title","Название"],["updatedAt","Последнее изменение"],["createdAt","Новые вверху"],["createdAtAsc","Старые вверху"] ] as const).map(([value,label])=><option key={value} value={value}>{translateText(label)}</option>)}
        {(snapshot.customFieldDefinitions??[]).filter(field=>field.type!=="multi").flatMap(field=>(['asc','desc'] as const).map(direction=><option key={`${field.id}:${direction}`} value={`custom:${field.id}:${direction}`} data-no-translate>{field.title} · {translateText(direction==='asc'?'По возрастанию':'По убыванию')}</option>))}</select></label>
        {!isCompact ? createTaskAction : null}
      </div></div>
      {activeView!=="gantt"?<SharedCustomFieldFilter key={projectId} fields={snapshot.customFieldDefinitions??[]} criteria={customCriteria.projectId===projectId?customCriteria.criteria:[]} onChange={criteria=>setCustomCriteria({projectId,criteria})} mode={calendarMode} language={language as import("./i18n").Language}/>:null}
      <div className="shared-planning-controls">
      <div className="shared-planning-view">
      <p className="shared-projects-calendar-mode-label">{english ? "Project view" : "Вид проекта"}</p>
      <ProjectViewSwitch order={projectViewOrder} active={activeView} language={language as import("./i18n").Language}
        dropView={dropTarget?.view} onSelect={item => { setGanttDay(undefined); setViewOverride(item); }} onReorder={onProjectViewOrder}/>
      </div>
      {!experimentalTheme && enabledCalendars.length > 1 ? <div className="shared-planning-dates">
      <p className="shared-projects-calendar-mode-label">{english ? "Calendar for project view and task dates" : "Календарь проекта и дат задач"}</p>
      <div className="shared-projects-calendar-mode display-calendar-choice" role="group" aria-label={english ? "Calendar for project view and task dates" : "Календарь проекта и дат задач"}>
        {(["profane", "sacred", "lunar"] as const).filter((mode) => enabledCalendars.includes(mode)).map((mode) => <button key={mode} type="button"
          aria-pressed={calendarMode === mode} onClick={() => {
            void onCalendarModeChange(mode);
            setCalendarMonth(new Date(`${calendarDay}T12:00:00`));
          }}>{mode === "profane" ? (english ? "Gregorian" : "Григорианский")
            : mode === "sacred" ? (english ? "Sacred" : "Сакральный") : (english ? "Lunar" : "Лунный")}</button>)}
      </div>
      </div> : null}
      </div>
      {activeView === "board" ? <p className="shared-projects-board-hint">{english
        ? "Swipe across the board to view all statuses."
        : "Проведите по доске, чтобы увидеть все статусы."}</p> : null}
      </section>
      <div className="shared-projects-workspace">
      {activeView === "calendar" ? <div className="shared-calendar-toolbar"><SharedTaskPageControls page={snapshot.taskPage} loaded={snapshot.tasks.length} busy={projectPage.busy} onMore={() => void projectPage.more()} onRefresh={() => void projectPage.refresh()} error={projectPage.error} showCount={activeView === "calendar"}/>
        <div className="shared-calendar-scale" role="group" aria-label={(calendarScaleCopy[language as import("./i18n").Language] ?? calendarScaleCopy.en).group}>
          {([1, 0.5, 0.25] as const).map(scale => {
            const size = scale === 1 ? "full" : scale === 0.5 ? "half" : "quarter";
            return <IconActionButton key={scale} icon={`calendar-scale-${size}`} data-scale={scale}
              label={(calendarScaleCopy[language as import("./i18n").Language] ?? calendarScaleCopy.en)[size]}
              aria-pressed={calendarScale === scale} choiceHint onClick={() => onCalendarScale(scale)}/>;
          })}
        </div>
      </div> : activeView !== "gantt" ? <SharedTaskPageControls page={snapshot.taskPage} loaded={snapshot.tasks.length} busy={projectPage.busy} onMore={() => void projectPage.more()} onRefresh={() => void projectPage.refresh()} error={projectPage.error} showCount={false}/> : null}
      {activeView === "gantt" ? <SharedGantt snapshot={snapshot} english={english} calendarMode={calendarMode} timeFormat={timeFormat} initialDay={ganttDay} onOpen={openTask} onCreate={schedule=>{openCreateTask(snapshot.project);setNewPlan({startDate:schedule.startDate,startTime:schedule.startTime||"",endTime:schedule.endTime||"",dependsOnIds:[]});setNewTaskDueDate(schedule.dueDate);}} onSchedule={scheduleTask} onReturn={returnGanttTask} resolveReturn={resolveGanttReturn} onReturnTarget={setGanttReturnTarget} busy={busy} externalDrop={sharedDrag.target?.schedule} externalDropRow={sharedDrag.target?.ganttRow}/> : activeView === "calendar" ? <section className={`shared-projects-calendar${calendarMode === "profane" ? " weekday-tinted-calendar" : ""}`} style={{ "--month-accent": MONTHS[getSacredDate(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 15, 12)).monthIndex].color } as CSSProperties} aria-label={english ? "Project calendar" : "Календарь проекта"}>
        <div className="shared-projects-calendar-head">
          <button type="button" aria-label={english ? "Previous month" : "Предыдущий месяц"} onClick={() => { setCalendarMonth(calendarPeriod.previous); setCalendarDay(localDateKey(calendarPeriod.previous)); }}>←</button>
          <h2>{calendarPeriod.title}</h2>
          <button type="button" aria-label={english ? "Next month" : "Следующий месяц"} onClick={() => { setCalendarMonth(calendarPeriod.next); setCalendarDay(localDateKey(calendarPeriod.next)); }}>→</button>
        </div>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Focus enables keyboard scrolling of the wide date grid. */}
        <div className="shared-projects-calendar-scroll" data-calendar-scale={calendarScale} style={{ "--calendar-scale": calendarScale } as CSSProperties} tabIndex={0} role="region" aria-label={english ? "Project calendar" : "Календарь проекта"}>
        {calendarScale === 0.25 ? <div className="shared-calendar-months">
          {calendarWindow.periods.map(period => <section key={localDateKey(period.dates[0])} className="shared-calendar-month"
            data-calendar-month={localDateKey(period.dates[0])} aria-label={period.title}
            style={{ "--month-accent": MONTHS[getSacredDate(period.dates[0]).monthIndex].color } as CSSProperties}>
            <h3>{period.title}</h3>{renderCalendarPeriod(period)}
          </section>)}
        </div> : renderCalendarPeriod(calendarPeriod)}
        </div>
        {undatedCalendarTasks.length ? <details className="shared-projects-calendar-undated">
          <summary><ExperimentalIcon name="chevron" /><span>{english ? "Tasks without a due date" : "Задачи без срока"}</span><small>{undatedPage.page?.total ?? 0}</small></summary>
          <p>{english ? "Drag a task onto a calendar date to schedule it." : "Перетащите задачу на дату календаря, чтобы назначить срок."}</p>
          <div className="shared-calendar-task-list">{undatedCalendarTasks.map(renderCalendarTask)}</div>
          <SharedTaskPageControls page={undatedPage.page} loaded={undatedCalendarTasks.length} busy={undatedPage.busy} onMore={() => void undatedPage.more()} onRefresh={() => void undatedPage.refresh()} error={undatedPage.error}/>
        </details> : null}
        {completedCalendarTasks.length ? <details className="shared-projects-calendar-undated shared-calendar-completed">
          <summary><ExperimentalIcon name="chevron" /><span>{english ? "Completed tasks" : "Выполненные задачи"}</span><small>{completedPage.page?.total ?? 0}</small></summary>
          <SharedTaskBatches key={snapshot.project.id} tasks={completedCalendarTasks} page={completedPage.page} busy={completedPage.busy} error={completedPage.error}
            onMore={completedPage.more} onRefresh={() => void completedPage.refresh()} className="shared-calendar-task-list" renderTask={renderCalendarTask}/>
        </details> : null}
      </section> : <>
        {inboxHidden ? <InboxRestore english={english} onRestore={() => onInboxHidden(false)} /> : null}
        <div className="shared-project-board-workspace" data-inbox-workspace data-inbox-position={inboxPosition} data-inbox-hidden={inboxHidden}>
        <section className="inbox-card shared-project-chaos" hidden={inboxHidden} data-inbox-compact={inboxCompact}
          data-shared-drop-status="" data-shared-project-chaos aria-labelledby="shared-project-inbox-title"
          data-drop-active={dropTarget?.projectId === snapshot.project.id && dropTarget.statusId === "" && !dropTarget.schedule && !dropTarget.unschedule || undefined}>
          <InboxToolbar title={english ? "Inbox" : "Хаос-бокс"} scopeLabel={english ? "Project" : "Проект"} titleId="shared-project-inbox-title"
            count={projectInboxTasks.length + projectInboxChildren.length} english={english} position={inboxPosition} compact={inboxCompact}
            onPosition={onInboxPosition} onCompact={onInboxCompact} onHide={() => onInboxHidden(true)} />
          <div className="shared-project-chaos-items">
          {projectInboxTasks.map(task => renderBoardTask(task, {
            id:"",title:english ? "Project inbox" : "Хаос-бокс проекта",isDone:task.completedAt ? 1 : 0,position:-1,revision:1,
          }))}
          {projectInboxChildren.map(renderBoardContainer)}
          {!projectInboxTasks.length && !projectInboxChildren.length ? <p>{translateText("Перетащите сюда задачи и подпроекты, чтобы оставить их вне досок.", language as import("./i18n").Language)}</p> : null}
          </div>
        </section>
        {!inboxHidden ? <InboxResizeBoundary position={inboxPosition} width={inboxWidth} onWidth={onInboxWidth} /> : null}
        <div className={`shared-project-board-content ${activeView === "board" ? "shared-projects-board" : "shared-projects-list"}`}>
        {snapshot.statuses.map((status) => {
          const group = activeView === "board" ? boardTaskGroups(snapshot.tasks, status) : {recent:snapshot.tasks.filter(task => task.statusId === status.id),older:[]};
          return <section key={status.id} className="shared-projects-column"
          data-shared-drop-status={status.id}
          style={{ "--shared-board-color": status.color ?? "#2d6c68" } as CSSProperties}
          data-drop-active={dropTarget?.statusId === status.id || undefined}
          aria-labelledby={`shared-board-title-${status.id}`}>
          <header className="shared-board-header" style={{ borderColor: status.color ?? "#2d6c68" }}>
            <h2 id={`shared-board-title-${status.id}`}>{canManage ? boardTitleEdit?.id === status.id ? <input className="shared-board-title-input"
              aria-label={english ? "Board name" : "Название доски"} maxLength={80} value={boardTitleEdit.title}
              ref={(element) => { if (element && document.activeElement !== element) { element.focus(); element.select(); } }}
              onChange={(event) => setBoardTitleEdit({ id: status.id, title: event.target.value })}
              onBlur={() => saveBoardTitle(status)} onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
                if (event.key === "Escape") { cancelledBoardTitleRef.current = true; setBoardTitleEdit(null); }
              }} /> : <button type="button" className="shared-board-title" disabled={busy} data-no-translate
                title={statusLabel(status.title)}
                aria-label={`${translateText("Переименовать",language as import("./i18n").Language)} «${status.title}»`}
                onClick={() => { cancelledBoardTitleRef.current = false; setBoardTitleEdit({ id: status.id, title: statusLabel(status.title) }); }}>{statusLabel(status.title)}</button>
              : <span data-no-translate>{statusLabel(status.title)}</span>}</h2>
            {snapshot.taskPage ? <SharedTaskPageCount loaded={group.recent.length + group.older.length} total={snapshot.taskPage.statusCounts[status.id] ?? 0}/>
              : <small className="shared-board-task-count" aria-label={english ? "Task count" : "Количество задач"} data-no-translate>{formatTaskCount(group.recent.length + group.older.length, language as import("./i18n").Language)}</small>}
          {canWrite || canManage ? <div className="shared-board-create-actions" role="group" aria-labelledby={`shared-board-title-${status.id}`}>
            {canWrite ? <><div className="shared-board-create-work">
            <button type="button" className="shared-board-create-task" onClick={() => openCreateTask(snapshot.project, status)}
              aria-label={english ? "Create task" : "Создать задачу"}>
              <ExperimentalIcon name="task" />
            </button>
            {(["project", "task-list"] as const).map((kind) => <button type="button" className={`shared-board-create-${kind}`} key={kind}
              aria-label={kind === "project" ? (english ? "Create project" : "Создать проект") : translateText("Создать список задач")}
              onClick={() => {
              if (kind === "task-list") { openCreateTask(snapshot.project, status, "task-list"); return; }
              setCreateKind(kind); setParentId(snapshot.project.id); setParentBoardId(status.id); setCreateModal("project");
            }}><ExperimentalIcon name={kind === "project" ? "project-plus" : "list"} />
              </button>)}
            </div><div className="shared-board-create-events">{(["meeting", "event"] as const).map(type => <button type="button" className={`shared-board-create-${type}`} key={type} aria-label={`${english ? "Create" : "Создать"}: ${entryTypeLabel(type,english)}`} onClick={() => openCreateTask(snapshot.project,status,type)}><ExperimentalIcon name={type}/></button>)}</div></> : null}
            {canManage ? <button type="button" className="shared-board-settings" disabled={busy} aria-label={english ? `Settings for ${status.title}` : `Настройки доски «${status.title}»`} title={english ? "Board settings" : "Настройки доски"} onClick={() => openBoardSettings(status)}><ExperimentalIcon name="gear" /></button> : null}
          </div> : null}
          </header>
          {status.imageUrl ? <img className="shared-board-image" src={status.imageUrl} alt={status.title} /> : null}
          {projects.filter(child => child.parentId === snapshot.project.id && child.boardStatusId === status.id).map(renderBoardContainer)}
          {group.recent.map(task => renderBoardTask(task, status))}
          {group.older.length ? <details className="shared-board-older-tasks" open={group.older.some(task => task.id === locatedTaskId) || undefined}>
            <summary><ExperimentalIcon name="chevron" /><span>{english ? "Older tasks" : "Предыдущие задачи"}</span><small>{group.older.length}</small></summary>
            <div>{group.older.map(task => renderBoardTask(task, status))}</div>
          </details> : null}
          {!snapshot.tasks.some((task) => task.statusId === status.id) ? <p className="shared-projects-column-empty">
            {english ? "No tasks here yet" : "Здесь пока нет задач"}</p> : null}
        </section>;})}
        {activeView === "board" && (snapshot.project.canCreateBoards ?? canManage) && snapshot.statuses.length < 30 ? <button type="button"
          className="shared-projects-add-column" onClick={() => setCreateModal("status")}>
          <ExperimentalIcon name="plus" />{english ? "Add board" : "Добавить доску"}</button> : null}
      </div></div></>}

      </div>
      </section>
      </div>
      {projectCategorySection}
      {selectedSpace ? <Suspense fallback={null}><SharedSpaceCollaboration key={spaceId} userId={userId} spaceId={spaceId} language={language} writeEnabled={writeEnabled}/></Suspense> : null}
      <details className="shared-projects-google" aria-label={english ? "My Google copies" : "Мои копии в Google"}>
        <summary><ExperimentalIcon name="chevron" /><span className="shared-disclosure-heading"><ExperimentalIcon name="copy"/>{english ? "My Google copies" : "Мои копии в Google"}</span>
          {(googleSettings?.tasksEnabled || googleSettings?.calendarEnabled) ? <span>{english ? "On" : "Включено"}</span> : null}</summary>
        <p>{english ? "Only you can enable copies in your Google account. The team task stays in GENESIS."
          : "Только вы можете включить копии в своём Google-аккаунте. Общая задача остаётся в GENESIS."}</p>
        <p>{english ? "Google Tasks copies include a link to the task in GENESIS. Photos and descriptions remain accessible in GENESIS to task participants."
          : "В Google Tasks добавляется ссылка на задачу GENESIS. Фото и описание доступны в GENESIS участникам задачи."}</p>
        {googleSettings ? <div className="shared-projects-google-options">
          <label><input type="checkbox" checked={googleSettings.tasksEnabled}
            disabled={googleBusy || !googleSettings.tasksAvailable && !googleSettings.tasksEnabled}
            onChange={(event) => changeGoogle("tasksEnabled", event.target.checked)} />
            {english ? "Copy to my Google Tasks" : "Копировать в мои Google Tasks"}</label>
          <label><input type="checkbox" checked={googleSettings.calendarEnabled}
            disabled={googleBusy || !googleSettings.calendarAvailable && !googleSettings.calendarEnabled}
            onChange={(event) => changeGoogle("calendarEnabled", event.target.checked)} />
            {english ? "Show in my Google Calendar" : "Показывать в моём Google Calendar"}</label>
          {(!googleSettings.tasksAvailable || !googleSettings.calendarAvailable) ? <small>{english
            ? "Connect the corresponding Google service in your account settings to enable its copy."
            : "Для включения копии подключите соответствующий сервис Google в настройках аккаунта."}</small> : null}
          {(googleSettings.tasksEnabled || googleSettings.calendarEnabled) ? <button type="button" disabled={googleBusy}
            onClick={() => { setGoogleBusy(true); void syncSharedGoogle(snapshot.project.id).then((result) =>
              setGoogleStatus(english ? `Google copies updated: ${result.synced}.` : `Копии Google обновлены: ${result.synced}.`))
              .catch((error: unknown) => setGoogleStatus(error instanceof Error ? error.message : String(error)))
              .finally(() => setGoogleBusy(false)); }}>
            {english ? "Update copies now" : "Обновить копии сейчас"}</button> : null}
        </div> : <p>{english ? "Loading Google options…" : "Загружаем настройки Google…"}</p>}
        {googleStatus ? <p role="status">{googleStatus}</p> : null}
      </details>
      <SharedActivity key={snapshot.project.id} projectId={snapshot.project.id} english={english} refreshKey={activityKey}/>

    </> : !loading ? <section className="shared-projects-empty">
      <h2>{!spaces.length ? (english ? "Your team starts here" : "Начните общую работу") :
        (english ? "Choose or create a project" : "Выберите или создайте проект")}</h2>
      <p>{!spaces.length ? (english ? "Create a workspace, then invite people and add a project." : "Создайте пространство, затем добавьте проект и пригласите участников.") :
        (english ? "Choose a project or create one in the toolbar above." : "Выберите проект или создайте новый в строке сверху.")}</p>

    </section> : null}
    {!snapshot && spaceId ? projectCategorySection : null}
    {!snapshot && selectedSpace ? <Suspense fallback={null}><SharedSpaceCollaboration key={spaceId} userId={userId} spaceId={spaceId} language={language} writeEnabled={writeEnabled}/></Suspense> : null}
    {archivedProjects.length ? <details className="shared-projects-create">
      <summary><ExperimentalIcon name="chevron"/><span className="shared-disclosure-heading"><ExperimentalIcon name="archive"/>{english ? "Completed projects" : "Завершённые"} · {archivedProjects.length}</span></summary>
      <div className="shared-projects-members">{archivedProjects.map(project => <div key={project.id} className="shared-projects-member"><span>{project.title}</span>
        {project.permissions?.manageProjects?<IconActionButton icon="settings" label={workflowText('heading',language as import('./i18n').Language)} data-workflow-repair={project.id} disabled={busy} onClick={()=>setWorkflowScope(project)}/>:null}
        {project.role === "owner" ? <button type="button" className="project-complete-action" disabled={busy} title={english ? "Restore" : "Вернуть"} aria-label={english ? `Restore project “${project.title}”` : `Вернуть проект «${project.title}»`} onClick={() => restoreProject(project.id)}><svg className="project-restore-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1.7 7.3M4 4v6h6"/></svg></button> : null}
      </div>)}</div>
    </details> : null}
    </main>
    </div>
    {labelsOpen && spaceId ? <SharedLabelsDialog spaceId={spaceId} labels={labels} english={english} onClose={()=>setLabelsOpen(false)} onChanged={()=>refreshProjects(spaceId)}/> : null}
    {dragPreview ? <div className="shared-projects-drag-preview" aria-hidden="true"
      style={{ left: dragPreview.x + 14, top: dragPreview.y + 14 }}>{dragPreview.item.title}</div> : null}
    {previewProjectId?<Suspense fallback={null}><SharedEntityPreview key={previewProjectId} id={previewProjectId} language={language} onClose={()=>setPreviewProjectId("")} onEdit={data=>{setProjectId(data.project.id);setSnapshot(data);setEditProjectLabelIds(data.project.labelIds||[]);setCreateModal("settings");}}/></Suspense>:null}
    <dialog ref={taskDialogRef} className="shared-projects-modal shared-task-modal" aria-labelledby="shared-task-title"
      onClose={closeTask} onCancel={(event) => { if (busy) event.preventDefault(); }}>
      {selectedTask && taskSnapshot ? <>
        <header><h2 id="shared-task-title" data-no-translate>{selectedTask.title}</h2><DialogCloseButton type="button" className="shared-projects-close" disabled={busy} onClick={closeTask} aria-label={english ? "Close task" : "Закрыть задачу"} /></header>
        <SharedTaskWatch key={`${taskSnapshot.project.id}:${selectedTask.id}`} userId={userId} projectId={taskSnapshot.project.id} taskId={selectedTask.id}/>
        {message ? <p className="shared-task-feedback" role="status">{message}</p> : null}
        <div className="shared-task-sections" role="tablist" tabIndex={-1} aria-label={english ? "Task details" : "Карточка задачи"} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "task" : event.key === "End" ? "comments" : taskSection === "task" ? "comments" : "task";
          setTaskSection(next); document.getElementById(next === "task" ? "shared-task-tab" : "shared-comments-tab")?.focus();
        }}>
          <button type="button" role="tab" id="shared-task-tab" tabIndex={taskSection === "task" ? 0 : -1} aria-selected={taskSection === "task"} aria-controls="shared-task-fields" onClick={() => setTaskSection("task")}>{english ? "Task" : "Задача"}</button>
          <button type="button" role="tab" id="shared-comments-tab" tabIndex={taskSection === "comments" ? 0 : -1} aria-selected={taskSection === "comments"} aria-controls="shared-task-discussion" onClick={() => setTaskSection("comments")}>{english ? "Comments" : "Комментарии"} · {comments.length}</button>
        </div>
        <div className="shared-task-tab-panels">
        <div id="shared-task-fields" role="tabpanel" aria-labelledby="shared-task-tab" hidden={taskSection !== "task"}>
        {!taskEditing ? <section className="entity-information shared-task-provenance">
          <dl><div><dt>{english ? "Created by" : "Создатель"}</dt><dd data-no-translate>{taskSnapshot.members.find(member=>member.userId===selectedTask.createdBy)?.displayName || "—"}</dd></div>
          <div><dt>{english ? "Created" : "Создано"}</dt><dd>{selectedTask.createdAt ? new Intl.DateTimeFormat(language,{dateStyle:"medium",timeStyle:"short"}).format(new Date(selectedTask.createdAt)) : "—"}</dd></div>
          <div><dt>{english ? "Updated" : "Обновлено"}</dt><dd>{new Intl.DateTimeFormat(language,{dateStyle:"medium",timeStyle:"short"}).format(new Date(selectedTask.updatedAt))}</dd></div></dl>
          {canEditTask ? <div className="shared-task-card-actions"><IconActionButton icon="edit" label={translateText("Редактировать",language as import("./i18n").Language)} onClick={()=>openTask(selectedTask,taskSnapshot,true)}/><IconActionButton data-dialog-save-alternative="true" icon="copy" label={translateText("Сохранить как шаблон",language as import("./i18n").Language)} disabled={selectedTask.pending} onClick={()=>{closeTask();setTemplateScope({context:taskSnapshot,source:{taskId:selectedTask.id,title:selectedTask.title}});}}/></div> : null}
        </section> : null}
        {selectedTask.archivedAt ? <p>{translateText("Архив задач")}</p> : <SharedTaskReview task={selectedTask} userId={userId} onChanged={async()=>{await refreshTaskProject(selectedTask.projectId);await refreshProject(selectedTask.projectId);}}/>}
        {selectedTask.approvalRequired ? <section className="shared-task-approval-status">
          <h3>{english ? "Completion confirmations" : "Подтверждения выполнения"}</h3>
          <ul>{selectedTask.approvals?.map((item, index) => <li key={item.userId ?? index}><span data-no-translate>{item.displayName || (english ? "Former participant" : "Бывший участник")}</span><span>{item.approvedAt ? (english ? "Confirmed" : "Подтверждено") : (english ? "Pending" : "Ожидается")}</span></li>)}</ul>
          {!selectedTask.archivedAt && selectedTask.approvals?.some(item => item.userId === userId && !item.approvedAt) ? <button className="primary-button" type="button" disabled={busy || selectedTask.pending} onClick={() => confirmTask(selectedTask)}>{english ? "Confirm completion" : "Подтвердить выполнение"}</button> : null}
        </section> : null}
        <div className="shared-task-quick-fields" hidden={!taskEditing}>
        {!selectedTask.archivedAt && taskSnapshot.project.canOrganizeTasks ? <div className="shared-projects-detail-move">
          {!taskSnapshot.project.isInbox ? <label>{english ? "Board" : "Доска"}<select value={taskSnapshot.statuses.some(board => board.id === selectedTask.statusId) ? selectedTask.statusId : ""} disabled={busy}
            onChange={(event) => moveTask(selectedTask, event.target.value)}>
            <option value="">{english ? "Project inbox" : "Хаос-бокс проекта"}</option>
            {taskSnapshot.statuses.map((status) => <option key={status.id} value={status.id} data-no-translate>{statusLabel(status.title)}</option>)}
          </select></label> : null}

        </div> : null}

        {canEditTask ? <label>{english ? "Assigned to" : "Исполнитель"}<select value={selectedTask.assigneeId ?? ""} disabled={busy} onChange={(event) => assignTask(selectedTask, event.target.value)}>
          <option value="">{english ? "Unassigned" : "Не назначен"}</option>
          {taskSnapshot.members.map((member) => <option key={member.userId} value={member.userId} data-no-translate>{member.displayName}</option>)}
        </select></label> : null}
        </div>
        {taskEditing && canEditTask ? <form id="shared-task-edit-form" onSubmit={submitTaskEdit}>
          <label>{english ? "Name" : "Название"}<textarea rows={2} value={editTaskTitle} onChange={(event) => setEditTaskTitle(event.target.value)} maxLength={160} placeholder={entryTypeTitlePlaceholder(editEntryType)} required /></label>
          <label>{english ? "Description" : "Описание"}<textarea value={editTaskDescription} onChange={(event) => setEditTaskDescription(event.target.value)} maxLength={20000} /></label>
          <SharedCustomFieldInputs fields={taskSnapshot.customFieldDefinitions??[]} values={editCustomFields} onChange={setEditCustomFields} language={language as import("./i18n").Language} mode={editTaskCalendarMode} disabled={busy}/>
          {taskSnapshot.project.planning?.enabled?<SharedEstimateInputs value={editEstimates} onChange={setEditEstimates} language={language as import('./i18n').Language} disabled={busy||selectedTask.revision!==editTaskRevision}/>:null}
          <SharedTaskSchedule part="primary" plan={editPlan} onChange={setEditPlan} dueDate={editTaskDueDate} onDueDate={setEditTaskDueDate} mode={editTaskCalendarMode} timeFormat={timeFormat} english={english} tasks={taskSnapshot.tasks} projectId={selectedTask.projectId} taskId={selectedTask.id}/>
          <SharedTaskDetailsEditor key={selectedTask.id} task={selectedTask} value={editTaskDetails} onChange={setEditTaskDetails} members={taskSnapshot.members} mode={editTaskCalendarMode}
            disabled={busy || selectedTask.revision !== editTaskRevision} saved={taskDraftSaved}
            onOpen={(projectId, taskId) => void run(async () => { const [context, task] = await Promise.all([loadSharedProject(projectId), loadSharedTask(projectId, taskId, true)]); openTask(task, context); })}
            onConvert={itemId => void run(async () => { await convertSharedChecklistItem(selectedTask, itemId, crypto.randomUUID()); const task = await loadSharedTask(selectedTask.projectId, selectedTask.id); openTask(task, taskSnapshot); await refreshProject(task.projectId); })}
            onCreateChild={async title => { const statusId = selectedTask.statusId;
              const task = await createSharedTask(selectedTask.projectId, { title, statusId, parentTaskId: selectedTask.id, priority: editTaskDetails.priority });
              if (!task.pending) { await refreshProject(task.projectId); openTask(task, taskSnapshot); }
              else setMessage(translateText("Изменение сохранено на устройстве и ожидает подключения к сети."));
            }}/>
          <details className="task-advanced-fields"><summary>{english ? "Details and settings" : "Подробности и настройки"}</summary>
          {taskProjectChoice}
          <RecordCalendarChoice value={editTaskCalendarMode} onChange={setEditTaskCalendarMode} language={language} />
          <SharedTaskSchedule plan={editPlan} onChange={setEditPlan} dueDate={editTaskDueDate} onDueDate={setEditTaskDueDate} mode={editTaskCalendarMode} timeFormat={timeFormat} english={english} tasks={taskSnapshot.tasks} projectId={selectedTask.projectId} taskId={selectedTask.id}/>
          <EntryTypeChoice value={editEntryType} types={["task","meeting","event"]} english={english} disabled={busy} onChange={setEditEntryType}/>
          <label>{english ? "Tags" : "Теги"}<input value={editTaskTags} onChange={(event) => setEditTaskTags(event.target.value)} placeholder="работа, запуск" /></label>
          <SharedTaskAttachmentsInput key={selectedTask.id} value={editTaskFiles} onChange={setEditTaskFiles}
            onReadingChange={setEditTaskFilesReading} english={english} disabled={busy || selectedTask.revision !== editTaskRevision}
            existing={(selectedTask.attachments ?? []).filter(file => !removedTaskFileIds.includes(file.id))}
            onRemoveExisting={id => setRemovedTaskFileIds(current => [...current, id])} />
          <SharedLabelPicker labels={labels} value={editTaskLabelIds} onChange={setEditTaskLabelIds} english={english} onManage={canManageLabels ? ()=>setLabelsOpen(true) : undefined}/>
          {(selectedTask.createdBy === userId || taskSnapshot.project.permissions?.manageProjects) ? <SharedTaskApprovalChoice enabled={editApprovalRequired} ids={editApproverIds} members={taskSnapshot.members} english={english}
            disabled={busy || Boolean(selectedTask.completedAt) || selectedTask.revision !== editTaskRevision}
            onEnabled={value => { setEditApprovalRequired(value); setApprovalConfigChanged(true); }} onIds={ids => { setEditApproverIds(ids); setApprovalConfigChanged(true); }} /> : null}
          </details>
          {selectedTask.revision !== editTaskRevision ? <p role="status">{english ? "This task changed elsewhere. Your draft is kept. Reload its fields before saving." : "Задача изменилась у другого участника. Черновик сохранён; обновите поля перед сохранением."}
            <button type="button" onClick={() => openTask(selectedTask, taskSnapshot, true)}>{english ? "Reload fields" : "Обновить поля"}</button></p> : null}

        </form> : <>{selectedTask.description ? <p data-no-translate>{selectedTask.description}</p> : null}
          <SharedTaskReadOnlyMetadata task={selectedTask} snapshot={taskSnapshot} labels={labels} statusName={statusLabel(taskSnapshot.statuses.find(status=>status.id===selectedTask.statusId)?.title ?? "")} mode={editTaskCalendarMode} timeFormat={timeFormat}
            onOpen={(projectId, taskId)=>void run(async()=>{const [context,task]=await Promise.all([loadSharedProject(projectId),loadSharedTask(projectId,taskId,true)]);openTask(task,context);})}/>
          <SharedCustomFieldValues fields={taskSnapshot.customFieldDefinitions??[]} values={selectedTask.customFields??{}} language={language as import("./i18n").Language} mode={editTaskCalendarMode}/>
          {taskSnapshot.project.planning?.enabled||selectedTask.storyPoints!=null||selectedTask.estimateHours!=null?<SharedEstimateValues task={selectedTask} language={language as import('./i18n').Language}/>:null}
          <SharedTaskDetailsEditor key={selectedTask.id} task={selectedTask} value={taskDetailsDraft(selectedTask)} onChange={() => undefined} members={taskSnapshot.members} mode={editTaskCalendarMode} disabled={busy} readOnly saved
          onConvert={() => undefined} onCreateChild={async () => undefined} onOpen={(projectId, taskId) => void run(async () => { const [context, task] = await Promise.all([loadSharedProject(projectId), loadSharedTask(projectId, taskId, true)]); openTask(task, context); })}/></>}

          {selectedTask.seriesId || taskEditing && canEditTask && taskSnapshot.project.canOrganizeTasks ? <Suspense fallback={null}><SharedTaskSeries key={selectedTask.id} task={selectedTask} mode={editTaskCalendarMode}
            readOnly={!taskEditing || !canEditTask || !taskSnapshot.project.canOrganizeTasks || Boolean(selectedTask.archivedAt)} disabled={busy || taskEditing && !taskFieldsSaved}
            onDirtyChange={setSeriesDirty} onSaved={async () => { await refreshTaskProject(selectedTask.projectId); await refreshProject(selectedTask.projectId); }}
            onOpen={(projectId, taskId) => void run(async () => { const [context, task] = await Promise.all([loadSharedProject(projectId), loadSharedTask(projectId, taskId, true)]); openTask(task, context); })}/></Suspense> : null}

          {!canEditTask && taskProjectChoice ? <details className="task-advanced-fields"><summary>{english ? "Details and settings" : "Подробности и настройки"}</summary>
          {taskProjectChoice}
          </details> : null}
        {selectedTask.imageUrl ? <SharedTaskImage key={selectedTask.id} src={selectedTask.imageUrl} english={english} /> : null}
        <SharedTaskAttachmentList files={selectedTask.attachments ?? []} english={english} />
        </div>
        <div id="shared-task-discussion" role="tabpanel" aria-labelledby="shared-comments-tab" hidden={taskSection !== "comments"}>
        <SharedComments key={`comments-${selectedTask.id}`} comments={comments} members={taskSnapshot.members} english={english} canComment={Boolean(canCommentTask)} busy={busy} onSubmit={submitComment} highlightedId={commentId} active={taskSection === "comments"}/>
        <SharedActivity key={`activity-${selectedTask.id}`} projectId={taskSnapshot.project.id} taskId={selectedTask.id} english={english} refreshKey={activityKey}/>
        </div>
        </div>
        {taskEditing && taskSection === "task" && canEditTask ? <footer className="shared-task-delete-footer"><button type="submit" form="shared-task-edit-form" className="primary-button shared-task-save" disabled={busy || editTaskFilesReading || selectedTask.revision !== editTaskRevision || editApprovalRequired && !editApproverIds.length}><ExperimentalIcon name="save"/>{english ? "Save task" : "Сохранить задачу"}</button>{!selectedTask.archivedAt && taskSnapshot.project.canOrganizeTasks ? <><button type="button" className="secondary-button" disabled={busy || !taskDraftSaved || selectedTask.pending} onClick={()=>void run(async()=>{
          const result=await setSharedTaskArchived(selectedTask,true);setUndoTaskAction({task:{...selectedTask,revision:result.revision}});closeTask();await refreshProject(selectedTask.projectId);await refreshProjects(spaceId);window.dispatchEvent(new Event("genesis:shared-updates"));
        })} title={translateText("Архивировать задачу и подзадачи")}><ExperimentalIcon name="archive"/>{translateText("Архивировать")}</button><button type="button" className="danger-button shared-task-delete-button" disabled={busy || selectedTask.pending} onClick={() => removeTask(selectedTask, taskSnapshot)}><ExperimentalIcon name="delete" />{english ? "Delete task" : "Удалить задачу"}</button></> : null}</footer> : null}
      </> : null}
    </dialog>
    <dialog ref={calendarAgendaRef} className="shared-projects-modal shared-calendar-day-modal" aria-labelledby="shared-calendar-day-title"
      onClose={() => setCalendarAgendaProjectId(null)}>
      {calendarAgendaOpen ? <>
        <header><h2 id="shared-calendar-day-title">{formatCalendarDate(new Date(`${calendarDay}T12:00:00`), calendarMode, true)}</h2>
          <DialogCloseButton type="button" className="shared-projects-close" aria-label={english ? "Close" : "Закрыть"} onClick={() => setCalendarAgendaProjectId(null)} />
        </header>
        <div className="shared-calendar-day-actions">
          {canWrite && snapshot ? <button type="button" className="primary-button" disabled={busy} onClick={() => { setCalendarAgendaProjectId(null); openCreateTask(snapshot.project, undefined, "task", true); setNewTaskDueDate(calendarDay); setNewPlan({ ...emptySharedPlan(), startDate: calendarDay }); }}><ExperimentalIcon name="plus" />{english ? "Create task" : "Создать задачу"}</button> : null}
          {snapshot?.project.canOrganizeTasks ? <button type="button" className="secondary-button" disabled={busy} aria-expanded={calendarTaskPicker} aria-controls="shared-calendar-task-choices" onClick={() => setCalendarTaskPicker(value => !value)}>{translateText("Выбрать задачу", language as import("./i18n").Language)}</button> : null}
          <button type="button" className="secondary-button shared-calendar-timeline-button" onClick={() => { setCalendarAgendaProjectId(null); setGanttDay(calendarDay); setViewOverride("gantt"); }}>{english ? "Daily timeline" : "Таймлайн дня"}</button>
          <span data-no-translate>{formatTaskCount(dayPage.page?.total ?? 0, language as import("./i18n").Language)}</span>
        </div>
        {calendarTaskPicker ? <div id="shared-calendar-task-choices" className="shared-calendar-task-choices">
          <label>{translateText("Поиск задач")}<input value={calendarTaskSearch} onChange={event => setCalendarTaskSearch(event.target.value)}/></label>
          {calendarTaskChoices.map(task => <button type="button" className="secondary-button" key={task.id} disabled={busy} data-no-translate onClick={() => {
            const duration = task.startDate && task.dueDate ? Math.max(0, dateSerial(task.dueDate) - dateSerial(task.startDate)) : 0;
            setCalendarTaskPicker(false); scheduleTask(task, { startDate: serialDate(dateSerial(calendarDay) - duration), dueDate: calendarDay, startTime: task.startTime ?? null, endTime: task.endTime ?? null });
          }}>{task.title}</button>)}
          <SharedTaskPageControls page={choicesPage.page} loaded={calendarTaskChoices.length} busy={choicesPage.busy} onMore={() => void choicesPage.more()} onRefresh={() => void choicesPage.refresh()} error={choicesPage.error}/>
          {!calendarTaskChoices.length ? <p>{english ? "No tasks here yet" : "Здесь пока нет задач"}</p> : null}
        </div> : null}
        {calendarTasks.length ? <div className="shared-calendar-task-list">{calendarTasks.map(renderCalendarTask)}</div>
          : <p className="shared-calendar-day-empty">{english ? "No active tasks due this day." : "На этот день нет активных задач со сроком."}</p>}
        {completedDayTasks.length ? <section><h3>{english ? "Completed tasks" : "Выполненные задачи"}</h3><div className="shared-calendar-task-list">{completedDayTasks.map(renderCalendarTask)}</div></section> : null}
        <SharedTaskPageControls page={dayPage.page} loaded={dayPage.page?.tasks.length ?? 0} busy={dayPage.busy} onMore={() => void dayPage.more()} onRefresh={() => void dayPage.refresh()} error={dayPage.error}/>
      </> : null}
    </dialog>
    <dialog ref={createDialogRef} className="shared-projects-modal" aria-labelledby="shared-projects-modal-title"
      onClose={closeCreateModal}>
      {createModal ? <>
        <header><h2 id="shared-projects-modal-title">{({
          space: english ? "New workspace" : "Новое пространство",
          "space-settings": english ? "Workspace settings" : "Настройки пространства",
          project: createKind === "task-list" ? (english ? "New task list" : "Новый список задач") : (english ? "New shared project" : "Новый общий проект"),
          task: english ? "New team task" : "Новая задача команды",
          status: english ? "New board" : "Новая доска",
          invite: english ? "Invite to workspace" : "Пригласить в пространство",
          join: english ? "Workspace invitations" : "Приглашения в пространства",
          settings: english ? "Project settings" : "Настройки проекта",
          team: english ? "Team" : "Команда",
          board: english ? "Board settings" : "Настройки доски",
        })[createModal]}</h2>
          <DialogCloseButton type="button" className="shared-projects-close" onClick={closeCreateModal}
            aria-label={english ? "Close" : "Закрыть"} />
        </header>
        {message ? <p className="shared-task-feedback" role="status">{message}</p> : null}
        {newTaskDestination && (createModal === "task" || createModal === "project" && createKind === "task-list") ? <div className="task-composer-tabs" role="group" aria-label={english ? "Create type" : "Тип дела"}>
          <IconActionButton icon="task" label={translateText("Задача", language as import("./i18n").Language)} showLabel choiceHint aria-pressed={createModal === "task" && newEntryType === "task"} onClick={() => { setNewEntryType("task"); setCreateModal("task"); }}/>
          <IconActionButton icon="list" label={translateText("Список задач", language as import("./i18n").Language)} showLabel choiceHint onClick={() => {
            setCreateKind("task-list"); setCreateModal("project");
          }} aria-pressed={createModal === "project"}/>
          {(["meeting", "event"] as const).map(type => <IconActionButton key={type} icon={type} label={translateText(entryTypeLabel(type, english), language as import("./i18n").Language)} showLabel choiceHint aria-pressed={createModal === "task" && newEntryType === type} onClick={() => { setNewEntryType(type); setCreateModal("task"); }}/>) }
        </div> : null}
        {createModal === "join" ? <div className="shared-invitations">
          {invitationsLoading ? <p role="status">{english ? "Loading invitations…" : "Загружаем приглашения…"}</p>
            : !invitations.length ? <p>{english ? "No invitations yet." : "Приглашений пока нет."}</p>
              : invitations.map((invitation) => <article key={invitation.id}><h3>{invitation.spaceTitle}</h3>
                <p>{invitation.inviterName}{invitation.projectTitle ? ` · ${invitation.projectTitle}` : ""}</p>
                <div><button type="button" className="primary-button" disabled={busy} onClick={() => void run(async () => {
                  const result = await acceptSharedInvitation(invitation.id); await refreshSpaces();
                  setSpaceId(result.spaceId); setCreateModal(null);
                })}>{english ? "Join" : "Присоединиться"}</button>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async () => {
                  await rejectSharedInvitation(invitation.id); setInvitations(await listSharedInvitations());
                })}>{english ? "Decline" : "Отклонить"}</button></div></article>)}
        </div> : null}
        {createModal === "settings" && snapshot ? <><SharedReviewSettings projectId={snapshot.project.id}/>      {canManage && !snapshot.project.isInbox ? <section className="shared-modal-section">
        <h3>{english ? "Project settings" : "Настройки проекта"}</h3>
        <form key={`${snapshot.project.id}:${snapshot.project.revision}`} onSubmit={submitProjectEdit}>
          <label>{english ? "Name" : "Название"}<input name="title" defaultValue={snapshot.project.title} maxLength={160} required /></label>
          <label>{english ? "Description" : "Описание"}<textarea name="description" defaultValue={snapshot.project.description} maxLength={5000} /></label>
          <SharedProjectLabels name="tags" defaultValue={snapshot.project.tags ?? []}/>
          <SharedLabelPicker labels={labels} value={editProjectLabelIds} onChange={setEditProjectLabelIds} english={english} onManage={canManageLabels ? ()=>setLabelsOpen(true) : undefined}/>
          {snapshot.project.kind !== "task-list" ? <label>{english ? "Category" : "Категория"}<select name="categoryId" defaultValue={snapshot.project.categoryId ?? ""}>
            <option value="">{english ? "No category" : "Без категории"}</option>
            {projectCategories.items.map(category => <option key={category.id} value={category.id}>{category.title}</option>)}
          </select></label> : null}
          <label>{english ? "Parent project" : "Родительский проект"}<select name="parentId" defaultValue={snapshot.project.parentId ?? ""}>
            <option value="">{english ? "Top level" : "Верхний уровень"}</option>
            {sharedProjectTree(projects.filter(project => project.id !== snapshot.project.id)).map(({ project, depth }) => <option key={project.id} value={project.id}>{depth ? `${"\u00a0\u00a0".repeat(depth)}↳ ` : ""}{project.title} · {formatTaskCount(project.taskCount ?? 0, language as import("./i18n").Language)}</option>)}
          </select></label>
          <footer className="space-settings-actions">{canManage ? <button type="button" className="danger-button" disabled={customFieldDraftOpen} onClick={()=>{setCreateModal(null);setTrashTarget({kind:"project",project:snapshot.project});}}>Удалить проект</button> : null}<button type="submit" className="primary-button" disabled={busy||customFieldDraftOpen}>{english ? "Save project" : "Сохранить проект"}</button></footer>
        </form>
        {snapshot.project.role === "owner" ? <button type="button" className="shared-projects-archive" disabled={busy||customFieldDraftOpen} onClick={archiveProject}>{english ? "Complete project" : "Завершить проект"}</button> : null}
      </section> : null}

      {canWrite?<button type="button" className="secondary-button" disabled={customFieldDraftOpen} onClick={()=>{setCreateModal(null);setTemplateScope({context:snapshot,source:{title:snapshot.project.title}});}}><ExperimentalIcon name="copy"/>{translateText("Сохранить проект как шаблон")}</button>:null}
      {["owner","admin"].includes(snapshot.project.spaceRole??"")?<Suspense fallback={null}><SharedCustomFieldManager key={`${userId}:${snapshot.project.id}`} userId={userId} spaceId={snapshot.project.spaceId} projectId={snapshot.project.id} language={language as import("./i18n").Language} onChanged={()=>refreshProject(snapshot.project.id)} onDirtyChange={setCustomFieldDraftOpen}/></Suspense>:null}
</> : null}
        {createModal === "team" && teamSnapshot ? <>
          {["owner", "admin"].includes(teamSnapshot.project.spaceRole ?? "") ? <SharedTeamPermissions onMessage={()=>setCreateModal(null)} key={teamSnapshot.project.spaceId} spaceId={teamSnapshot.project.spaceId} userId={userId} english={english} language={language as import("./i18n").Language} onChanged={async () => { setTeamSnapshot(await loadSharedProject(teamSnapshot.project.id)); await refreshSpaces(); await refreshProjects(teamSnapshot.project.spaceId); if (projectId) await refreshProject(projectId); }} /> : null}
          <section className="shared-modal-section">
        <h3>{english ? "Participants and roles" : "Участники и роли"}</h3>
        <div className="shared-team-members">{teamSnapshot.members.map((member) => <article key={member.userId} className="shared-team-member">
          <header className="shared-team-member-identity"><ExperimentalIcon name="team" /><div><h4>{member.displayName}</h4><span>{roleLabel(member.spaceRole)}</span></div>
            <SharedMemberMessageButton actorId={userId} peer={{spaceId:teamSnapshot.project.spaceId,userId:member.userId,displayName:member.displayName}} language={language} onOpen={()=>setCreateModal(null)}/>
          </header>
          <div className="shared-team-member-controls">
          {teamSnapshot.project.role === "owner" && !teamSnapshot.project.isInbox ? <>
            <label>{english ? "Role" : "Роль"}<select value={member.role} disabled={busy} onChange={(event) => setMemberRole(member.userId, event.target.value)}>
              {["owner", "manager", "member", "commenter", "viewer"].map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
            </select></label>
            <button type="button" disabled={busy || (member.role === "owner" && teamSnapshot.members.filter((item) => item.role === "owner").length === 1)} onClick={() => removeMember(member.userId)}>{english ? "Remove" : "Удалить"}</button>
          </> : !teamSnapshot.project.isInbox ? <p>{english ? "Project role" : "Роль в проекте"}: {roleLabel(member.role)}</p> : null}
          </div>
        </article>)}</div>
      </section>

          {["owner", "admin"].includes(spaces.find((space) => space.id === spaceId)?.role ?? "") ? <button type="button" className="primary-button" onClick={() => setCreateModal("invite")}>{english ? "Invite to workspace" : "Пригласить в пространство"}</button> : null}
        </> : null}
        {createModal === "board" && editingBoard && snapshot ? <form onSubmit={(event) => {
          event.preventDefault(); const fields = new FormData(event.currentTarget); const current = editingBoard;
          void run(async () => { await updateSharedStatus(snapshot.project.id, current.id, String(fields.get("title")), current.revision,
            { color: String(fields.get("color")), imageUrl: boardImage, isDone: fields.get("isDone") === "on", taskTitleLines: Number(fields.get("taskTitleLines")), visibleTaskCount: Number(fields.get("visibleTaskCount")) });
            await refreshProject(snapshot.project.id); setCreateModal(null); });
        }}>
          <label>{english ? "Board name" : "Название доски"}<input name="title" defaultValue={statusLabel(editingBoard.title)} required maxLength={80}/></label>
          <SharedBoardColor key={editingBoard.id} name="color" initialValue={editingBoard.color ?? "#2d6c68"} english={english}/>
          <label className="shared-projects-checkbox"><input name="isDone" type="checkbox" defaultChecked={Boolean(editingBoard.isDone)}/>{english ? "Tasks here are completed" : "Задачи в этой доске завершены"}</label>
          <fieldset className="shared-board-display-settings"><legend>{english ? "Task display" : "Отображение задач"}</legend>
            <label>{english ? "Task title length" : "Длина названия задачи"}<select name="taskTitleLines" defaultValue={boardDisplay(editingBoard).titleLines}>
              <option value="0">{english ? "Full title" : "Полное название"}</option>
              {[1,2,3].map(lines => <option key={lines} value={lines}>{english ? `${lines} lines` : `${lines} ${lines === 1 ? "строка" : "строки"}`}</option>)}
            </select></label>
            <label>{english ? "Recent tasks shown" : "Последних задач на доске"}<input name="visibleTaskCount" type="number" min="0" max="1000" step="1" required defaultValue={boardDisplay(editingBoard).visibleCount}/></label>
            <p>{english ? "0 shows all tasks. Older tasks stay in an expandable list. You can expand shortened titles on each card." : "0 — показывать все задачи. Предыдущие задачи остаются в раскрываемом списке. Сокращённое название можно развернуть в карточке."}</p>
          </fieldset>
          <label>{english ? "Image URL" : "Ссылка на изображение"}<input type={boardImage.startsWith("data:") ? "text" : "url"} value={boardImage.startsWith("data:") ? "" : boardImage} onChange={(event) => setBoardImage(event.target.value)} placeholder="https://…"/></label>
          <label>{english ? "Upload image (up to 500 KB)" : "Загрузить изображение (до 500 КБ)"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
            const file = event.target.files?.[0]; if (!file) return;
            if (file.size > 500000 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
              setMessage(english ? "Choose PNG, JPG or WebP up to 500 KB." : "Выберите PNG, JPG или WebP до 500 КБ."); return;
            }
            const reader = new FileReader(); reader.onload = () => setBoardImage(String(reader.result)); reader.readAsDataURL(file);
          }}/></label>
          {boardImage ? <><img className="shared-board-image" src={boardImage} alt={english ? "Board preview" : "Изображение доски"}/><button type="button" onClick={() => setBoardImage("")}>{english ? "Remove image" : "Убрать изображение"}</button></> : null}
          <button type="submit" className="primary-button" disabled={busy}>{english ? "Save board" : "Сохранить доску"}</button>
          <SharedActivity key={editingBoard.id} projectId={snapshot.project.id} boardId={editingBoard.id} english={english} refreshKey={activityKey}/>
          <details className="shared-board-delete"><summary><ExperimentalIcon name="close" />{english ? "Delete board" : "Удалить доску"}</summary>
            <label>{english ? "Move its contents to" : "Переместить содержимое в"}<select value={statusDestinations[editingBoard.id] ?? snapshot.statuses.find((item) => item.id !== editingBoard.id)?.id ?? ""}
              onChange={(event) => setStatusDestinations((current) => ({ ...current, [editingBoard.id]: event.target.value }))}>
              {snapshot.statuses.filter((item) => item.id !== editingBoard.id).map((item) => <option key={item.id} value={item.id} data-no-translate>{statusLabel(item.title)}</option>)}
            </select></label>
            <button type="button" className="shared-board-delete-confirm" disabled={busy || snapshot.statuses.length < 2} onClick={() => {
              removeStatus(editingBoard.id, editingBoard.revision, statusDestinations[editingBoard.id] ?? snapshot.statuses.find((item) => item.id !== editingBoard.id)?.id ?? "");
              setCreateModal(null);
            }}><ExperimentalIcon name="close" />{english ? "Delete and move contents" : "Удалить и перенести содержимое"}</button>
          </details>
        </form> : null}
        {createModal === "space" || createModal === "space-settings" ? <SharedSpaceForm key={createModal === "space" ? "new-space" : editingSpaceId}
          language={language} spaceId={createModal === "space-settings" ? editingSpaceId : undefined} ownedProjectQuota={ownedProjectQuota}
          onSaved={(space) => { spacesRequest.current++; setSpaces(current => current.some(item => item.id === space.id) ? current.map(item => item.id === space.id ? { ...item, ...space } : item) : [...current, space]); void refreshSpaces().catch(() => undefined); setSpaceId(space.id); setCreateModal(null); setMessage(english ? "Workspace saved." : "Пространство сохранено."); }}
          onDeleted={(id) => { setSpaces((current) => current.filter((space) => space.id !== id)); void refreshSpaces().catch(() => undefined);
            if (spaceId === id) { setSpaceId(""); setProjectId(""); setSnapshot(null); setInboxPreview(null); setProjects([]); }
            setCreateModal(null); }} /> : null}
        {createModal === "project" ? <form onSubmit={submitProject}>
          <label>{english ? "Name" : "Название"}<input value={projectTitle} maxLength={160} required onChange={(event) => setProjectTitle(event.target.value)} /></label>
          <label>{english ? "Description" : "Описание"}<textarea value={projectDescription} maxLength={5000} onChange={(event) => setProjectDescription(event.target.value)} /></label>
          <SharedProjectLabels value={projectTags} onChange={setProjectTags}/>
          <SharedLabelPicker labels={labels} value={projectLabelIds} onChange={setProjectLabelIds} english={english} onManage={canManageLabels ? ()=>setLabelsOpen(true) : undefined}/>
          {createKind === "project" ? <label>{english ? "Category" : "Категория"}<select value={projectCategoryId} onChange={event => setProjectCategoryId(event.target.value)}>
            <option value="">{english ? "No category" : "Без категории"}</option>
            {projectCategories.items.map(category => <option key={category.id} value={category.id}>{category.title}</option>)}
          </select></label> : null}
          <label>{english ? "Parent project" : "Родительский проект"}<select value={parentId} onChange={(event) => setParentId(event.target.value)}>
            <option value="">{english ? "Top level" : "Верхний уровень"}</option>
            {sharedProjectTree(projects).map(({ project, depth }) => <option key={project.id} value={project.id}>{depth ? `${"\u00a0\u00a0".repeat(depth)}↳ ` : ""}{project.title} · {formatTaskCount(project.taskCount ?? 0, language as import("./i18n").Language)}</option>)}
          </select></label>
          <button type="submit" className="primary-button" disabled={busy||!sharedProjectQuotaAvailable(selectedSpace?.projectQuota,parentId)}>{createKind === "task-list" ? (english ? "Create task list" : "Создать список задач") : (english ? "Create project" : "Создать проект")}</button>
        </form> : null}
        {createModal === "task" && newTaskDestination ? <form className="shared-task-composer" onSubmit={submitTask}>
          <section className="shared-task-form-section">
          <label>{english ? "Name" : "Название"}<textarea rows={2} maxLength={160} required value={newTaskTitle} onChange={(event) => setNewTaskTitle(event.target.value)} placeholder={entryTypeTitlePlaceholder(newEntryType)} /></label>
          </section>
          <SharedTaskSchedule part="primary" plan={newPlan} onChange={setNewPlan} dueDate={newTaskDueDate} onDueDate={setNewTaskDueDate} mode={newTaskCalendarMode} timeFormat={timeFormat} english={english} projectId={newTaskDestination.projectId || inboxProject?.id} tasks={newTaskContext && newTaskContext.project.id===(newTaskDestination.projectId || inboxProject?.id) ? newTaskContext.tasks : []}/>
          <details className="task-advanced-fields"><summary>{english ? "Details and settings" : "Подробности и настройки"}</summary>
          {newTaskRootProjectId ? <label>{english ? "Project or subproject" : "Проект или подпроект"}<select value={newTaskDestination.projectId}
            onChange={event => {
              if(Object.values(newCustomFields).some(value=>value!==null&&value!==undefined)&&!window.confirm(translateText("Очистить значения полей при смене проекта?")))return;
              const target = projects.find(project => project.id === event.target.value);
              setNewTaskDestination({ projectId: target?.id ?? "", title: target?.title ?? "", statusId: "", isInbox: false });
              setNewTaskContext(null); setNewPlan(current => ({ ...current, dependsOnIds: [] }));
              setNewApproverIds([]);setNewCustomFields({});
              const contextId = target?.id;
              if (contextId) void loadSharedProject(contextId).then(setNewTaskContext).catch(() => undefined);
            }}>
            {taskDestinationProjects.filter(({ project }) => project.kind !== "task-list" && (project.permissions?.editTasks ?? ["owner", "manager", "member"].includes(project.role)))
              .map(({ project, depth }) => <option value={project.id} key={project.id}>{depth ? `${"\u00a0\u00a0".repeat(depth)}↳ ` : ""}{project.title}</option>)}
          </select></label> : <p className="shared-task-destination">{english ? "Create in" : "Место создания"}: <strong>{newTaskDestination.title}</strong></p>}
          {newTaskContext ? <label>{english ? "Board" : "Доска"}<select value={newTaskDestination.statusId ?? ""}
            onChange={event => setNewTaskDestination({ ...newTaskDestination, statusId: event.target.value })} disabled={busy}>
            <option value="">{english ? "Project inbox" : "Хаос-бокс проекта"}</option>
            {newTaskContext.statuses.map(board => <option key={board.id} value={board.id} data-no-translate>{statusLabel(board.title)}</option>)}
          </select></label> : null}
          <SharedCustomFieldInputs fields={newTaskContext&&newTaskContext.project.id===(newTaskDestination.projectId||inboxProject?.id)?newTaskContext.customFieldDefinitions??[]:[]} values={newCustomFields} onChange={setNewCustomFields} language={language as import("./i18n").Language} mode={newTaskCalendarMode} disabled={busy||!newTaskContext}/>
          <RecordCalendarChoice value={newTaskCalendarMode} onChange={setNewTaskCalendarMode} language={language} />
          <SharedTaskSchedule plan={newPlan} onChange={setNewPlan} dueDate={newTaskDueDate} onDueDate={setNewTaskDueDate} mode={newTaskCalendarMode} timeFormat={timeFormat} english={english} projectId={newTaskDestination.projectId || inboxProject?.id} tasks={newTaskContext && newTaskContext.project.id===(newTaskDestination.projectId || inboxProject?.id) ? newTaskContext.tasks : []}/>
          <SharedTaskApprovalChoice enabled={newApprovalRequired} ids={newApproverIds} members={newTaskContext && newTaskContext.project.id === (newTaskDestination.projectId || inboxProject?.id) ? newTaskContext.members : []}
            english={english} disabled={busy || !newTaskContext} onEnabled={setNewApprovalRequired} onIds={setNewApproverIds} />
          <section className="shared-task-form-section"><h3>{english ? "Attachment" : "Вложение"}</h3>
          <SharedTaskAttachmentsInput value={newTaskFiles} onChange={setNewTaskFiles} onReadingChange={setNewTaskImageReading} english={english} disabled={busy} />
          </section>
          <label>{english ? "Description" : "Описание"}<textarea maxLength={20000} value={newTaskDescription} onChange={(event) => setNewTaskDescription(event.target.value)} /></label>
          <label>{english ? "Tags" : "Теги"}<input value={newTaskTags} onChange={(event) => setNewTaskTags(event.target.value)} placeholder="работа, запуск" /></label>
          <SharedLabelPicker labels={labels} value={newTaskLabelIds} onChange={setNewTaskLabelIds} english={english} onManage={canManageLabels ? ()=>setLabelsOpen(true) : undefined}/>
          </details>
          <button type="submit" className="primary-button" disabled={busy || newTaskContext?.project.id!==(newTaskDestination.projectId||inboxProject?.id) || newTaskImageReading || !newTaskTitle.trim() || !newTaskDestination.projectId && !inboxProject || newApprovalRequired && !newApproverIds.length}>{english ? "Create task" : "Создать задачу"}</button>
        </form> : null}
        {createModal === "status" ? <form onSubmit={submitStatus}>
          <label>{english ? "Name" : "Название"}<input value={newStatusTitle} maxLength={80} required onChange={(event) => setNewStatusTitle(event.target.value)} /></label>
          <SharedBoardColor value={newStatusColor} onChange={setNewStatusColor} english={english}/>
          <label className="shared-projects-checkbox"><input type="checkbox" checked={newStatusDone} onChange={(event) => setNewStatusDone(event.target.checked)} />{english ? "Completion list" : "Список завершённых задач"}</label>
          <button type="submit" className="primary-button" disabled={busy}>{english ? "Create board" : "Создать доску"}</button>
        </form> : null}
        {createModal === "invite" ? <form onSubmit={submitInvite}>
          <label>Email<input type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label>
          <label>{english ? "Role" : "Роль"}<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
            <option value="member">{english ? "Member — can edit" : "Участник — может редактировать"}</option>
            <option value="viewer">{english ? "Guest — can view" : "Гость — может просматривать"}</option>
          </select></label>
          <button type="submit" className="primary-button" disabled={busy}>{english ? "Create invitation" : "Создать приглашение"}</button>
        </form> : null}
      </> : null}
    </dialog>
  </div>;
}
