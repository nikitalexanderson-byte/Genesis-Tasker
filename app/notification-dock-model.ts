export type NoticeActivity = { count: number; tokens: string[]; title: string };
export type DockPosition = { x: number; y: number };
export type DockBounds = { left: number; top: number; right: number; bottom: number };
export type DockSize = { width: number; height: number };
export const NOTIFICATION_PREVIEW_MS = 5000;

export function clampDockSize(size: DockSize, bounds: DockBounds): DockSize {
  const width = Math.max(0, bounds.right - bounds.left), height = Math.max(0, bounds.bottom - bounds.top);
  return { width: Math.min(Math.max(size.width, 320), 760, width), height: Math.min(Math.max(size.height, 240), 820, height) };
}

export function clampDockPosition(position: DockPosition, bounds: DockBounds, width: number, height: number): DockPosition {
  return {
    x: Math.min(Math.max(position.x, bounds.left), Math.max(bounds.left, bounds.right - width)),
    y: Math.min(Math.max(position.y, bounds.top), Math.max(bounds.top, bounds.bottom - height)),
  };
}

export function dockHome(bounds: DockBounds, width: number, height: number): DockPosition {
  return clampDockPosition({ x: bounds.right - width, y: bounds.bottom - height }, bounds, width, height);
}

export function dockSavedPosition(x: number, y: number, bounds: DockBounds, width = 56, height = 56): DockPosition {
  if (x < 0 || y < 0) return dockHome(bounds, width, height);
  return clampDockPosition({ x: bounds.left + Math.max(0, bounds.right - bounds.left - width) * x / 10000,
    y: bounds.top + Math.max(0, bounds.bottom - bounds.top - height) * y / 10000 }, bounds, width, height);
}

export function dockPositionToLayout(position: DockPosition, bounds: DockBounds, width=56, height=56) {
  const fraction = (value: number, start: number, end: number, extent:number) => Math.max(0, Math.min(10000,
    Math.round((value - start) / Math.max(1, end - start - extent) * 10000)));
  return { notificationDockX: fraction(position.x, bounds.left, bounds.right,width),
    notificationDockY: fraction(position.y, bounds.top, bounds.bottom,height) };
}

const PANEL_SIZE_PREFIX='genesis.notification-panel.v1:';
const DEFAULT_PANEL_SIZE:DockSize={width:360,height:560};
export function loadNotificationPanelSize(storage:Pick<Storage,'getItem'>|null,userId:string):DockSize{
 try{const row=JSON.parse(storage?.getItem(PANEL_SIZE_PREFIX+(userId||'guest'))??'null');if(row&&Number.isInteger(row.width)&&Number.isInteger(row.height)&&row.width>=320&&row.width<=760&&row.height>=240&&row.height<=820)return {width:row.width,height:row.height};}catch{/* Use the standard panel if preferences are unavailable. */}
 return {...DEFAULT_PANEL_SIZE};
}
export function saveNotificationPanelSize(storage:Pick<Storage,'setItem'>,userId:string,size:DockSize){
 try{storage.setItem(PANEL_SIZE_PREFIX+(userId||'guest'),JSON.stringify({width:Math.round(size.width),height:Math.round(size.height)}));}catch{/* Geometry stays usable without persistent preferences. */}
}

/** Each unread event previews once per mounted account; collapsing never reads it. */
export function newestUnseenToken(tokens: string[], seen: Set<string>): string | null {
  const newest = tokens.find(token => !seen.has(token)) ?? null;
  for (const token of tokens) seen.add(token);
  return newest;
}
