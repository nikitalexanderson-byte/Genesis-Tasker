import copy from "./stoicheion-timeline.json";
import web from "./stoicheion-timeline-web.json";
import type { StoicheionDrawRecord, StoicheionTimelineRecord } from "./cloud-sync";

export type ClientTimelineRecord = Omit<StoicheionTimelineRecord,"cards"> & {
  cards:(StoicheionTimelineRecord["cards"][number] & {localDeadline:number})[];
};
/** A display-only monotonic countdown; every permission is checked again by the server. */
export function receiveTimeline(record:StoicheionTimelineRecord, receivedAt:number, requestDuration=0):ClientTimelineRecord {
  return {...record,cards:record.cards.map(card=>({...card,localDeadline:receivedAt+Math.max(0,card.remainingSeconds*1000-requestDuration)}))};
}
export function timelineCardSeconds(card:ClientTimelineRecord["cards"][number]|undefined, clock:number):number {
  return card?.canReroll?Math.max(0,Math.ceil((card.localDeadline-clock)/1000)):0;
}

const localizedCopy = Object.fromEntries(Object.keys(copy).map(key => [key, { ...copy[key as keyof typeof copy], ...web[key as keyof typeof web] }])) as { [K in keyof typeof copy]: typeof copy[K] & typeof web[K] };
export function stoicheionTimelineCopy(language: string) {
  const key = Object.hasOwn(copy, language) ? language as keyof typeof copy : "en";
  return localizedCopy[key];
}
export type StoicheionTimePosition = (typeof copy.ru.positions)[number];

// Separate from draws-v2: older daily/nine-card clients must not erase this draw.
export const LOCAL_TIMELINE_STORAGE_PREFIX = "genesis-stoicheion-draws-v2:timeline:";
type TimelineStorage = Pick<Storage, "getItem" | "setItem">;

// The deal stays identical across web and Android. Only its gradual web reveal
// is device-local; it must never spend a second server draw for the next card.
function revealKey(owner: string, draw: StoicheionDrawRecord) {
  return `${LOCAL_TIMELINE_STORAGE_PREFIX}reveal:${owner}:${draw.dayKey}:${draw.seed}:${draw.attempts}`;
}
export function readTimelineRevealed(storage: Pick<Storage, "getItem">, owner: string, draw: StoicheionDrawRecord): number {
  try {
    const count = Number(storage.getItem(revealKey(owner, draw)));
    return Number.isInteger(count) && count >= 1 && count <= 3 ? count : 3;
  } catch { return 3; }
}
export function saveTimelineRevealed(storage: TimelineStorage, owner: string, draw: StoicheionDrawRecord, count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 3) throw new RangeError("TIMELINE_REVEAL_INVALID");
  try { storage.setItem(revealKey(owner, draw), String(count)); } catch { /* A saved server draw must remain usable when local storage is full. */ }
}

export function stoicheionWeekStart(dayKey:string):string {
  const day=new Date(dayKey+'T12:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)||!Number.isFinite(day.getTime()))throw Error('TIMELINE_DAY_INVALID');
  day.setUTCDate(day.getUTCDate()-((day.getUTCDay()+6)%7));return day.toISOString().slice(0,10);
}
export function readLocalTimelineDraw(storage: Pick<Storage, "getItem">, dayKey: string, now = Date.now()): StoicheionDrawRecord | null {
  try {
    const start=stoicheionWeekStart(dayKey);let latest:StoicheionDrawRecord|null=null;
    for(let offset=0;offset<7;offset++){
      const date=new Date(start+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset);const key=date.toISOString().slice(0,10);if(key>dayKey)break;
      const draw=JSON.parse(storage.getItem(`${LOCAL_TIMELINE_STORAGE_PREFIX}${key}`)||'null') as StoicheionDrawRecord|null;
      if(!draw||draw.kind!=='timeline'||draw.dayKey!==key||![1,2].includes(draw.attempts)||!Number.isInteger(draw.seed)||draw.seed<0||draw.seed>0xffffffff
        ||!Number.isFinite(Date.parse(draw.firstDrawAt))||!Number.isFinite(Date.parse(draw.rerollDeadline)))continue;
      const remainingSeconds=draw.attempts===1?Math.max(0,Math.ceil((Date.parse(draw.rerollDeadline)-now)/1000)):0;
      latest={...draw,remainingSeconds,canReroll:draw.attempts===1&&remainingSeconds>0};
    }
    return latest;
  }catch{return null;}
}

export function saveLocalTimelineDraw(storage: TimelineStorage, seed: number, dayKey: string, now = Date.now()): StoicheionDrawRecord {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Зерно расклада указано неверно.");
  const existing = readLocalTimelineDraw(storage, dayKey, now);
  if (existing && !existing.canReroll) {
    throw new Error(existing.attempts >= 2 ? "Переброс на сегодня уже использован." : "Трёхминутное окно для переброса завершилось.");
  }
  const record: StoicheionDrawRecord = {
    kind: "timeline", dayKey: existing?.dayKey ?? dayKey, seed: seed >>> 0, attempts: existing ? 2 : 1,
    firstDrawAt: existing?.firstDrawAt ?? new Date(now).toISOString(),
    rerollDeadline: existing?.rerollDeadline ?? new Date(now + 180_000).toISOString(),
    remainingSeconds: existing ? 0 : 180, canReroll: !existing,
  };
  storage.setItem(`${LOCAL_TIMELINE_STORAGE_PREFIX}${record.dayKey}`, JSON.stringify(record));
  return record;
}
