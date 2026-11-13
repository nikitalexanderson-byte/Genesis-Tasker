"use client";
import {requestUpgrade} from "./upgrade-events";
import "./stoicheion-card-surfaces.css";
import { currentFeatureAccess,featureAllowed } from './feature-access';
import {FeatureAccessUI} from './FeatureAccessUI';
import { DialogCloseButton } from "./DialogCloseButton";

import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { stoicheionReadingSections } from "./stoicheion-reading";
import {splitStoicheionReading} from './stoicheion-reading-layout';
import {
  getStoicheionLetters,
  type StoicheionLetter,
} from "./stoicheion-data";
import { StoicheionCardFace } from "./StoicheionCardFace";
import { formatGreekTerms } from "./greek-terms";
import { catalogText, sacredWordCopy } from "./catalog-i18n";
import {
  isGoogleSyncConfigured,
  loadStoicheionDraws,
  saveStoicheionDraw,
  loadStoicheionTimelineCards,
  changeStoicheionTimelineCard,
  type StoicheionTimelineRecord,
  type StoicheionDrawKind,
  type StoicheionDrawRecord,
} from "./cloud-sync";
import { getRuntimeLanguage, runtimeLocale, translateText } from "./i18n";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { THEOKYKLOS_SEGMENTS } from "./theokyklos-data";
import {
  sacredPracticesForSector,
  SACRED_PRACTICES,
  sacredSectorGuidance,
  type StoicheionPracticeSectorId,
} from "./sacred-practices";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import { privateDeviceAccessBlocked } from "./local-sign-out";
import type { CalendarMode } from "./calendar-data";
import { createHabitFromSacredPractice, findStandardSacredHabit, type HabitWorkspace } from "./habits";
import habitPracticeCopy from "./habit-practice-copy.json";
import { StoicheionRestoration, type RestorationHandle, type RestorationPrimaryState } from "./StoicheionRestoration";
import { StoicheionActionButton } from "./StoicheionActionButton";
import { RESTORATION_SECTORS } from "./stoicheion-restoration-data";
import { restorationCopy, restorationLocal } from "./stoicheion-restoration-copy";
import { readLocalTimelineDraw, saveLocalTimelineDraw, stoicheionWeekStart, receiveTimeline, timelineCardSeconds, stoicheionTimelineCopy, type ClientTimelineRecord, type StoicheionTimePosition } from "./stoicheion-timeline";
import "./stoicheion-timeline.css";
import { FutureModelingGuide } from "./FutureModelingGuide";
import { snapshotFromSavedDraw, createTemporalTriad } from "./aurora/draw-policy";
import type { AuroraTaskRequest } from "./aurora/host";
import { StoicheionTimelineHelp } from "./StoicheionTimelineHelp";
import alphabetCopy from "./stoicheion-alphabet-copy.json";
import "./stoicheion-alphabet.css";

const LOCAL_DRAW_STORAGE_PREFIX = "genesis-stoicheion-draws-v2:";
const INITIAL_ENTROPY = 0x9e3779b9;
const subscribeModelingDesktop = (listener: () => void) => {
  const query = window.matchMedia('(min-width: 1024px)');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};
const modelingDesktopSnapshot = () => window.matchMedia('(min-width: 1024px)').matches;
const modelingServerSnapshot = () => false;

type ClientDrawRecord = StoicheionDrawRecord & { localDeadline: number };

type MotionMode = StoicheionDrawKind;

type MotionTracker = {
  mode: MotionMode;
  seed: number;
  travel: number;
  lastX: number | null;
  lastY: number | null;
  replaceCurrent: boolean;
  position?: number;
};

type SelectedReading = {
  letter: StoicheionLetter;
  reversed: boolean | null;
  position: SpreadPosition | null;
  timeline?: StoicheionTimePosition;
};

const MOTION_TRAVEL_REQUIRED = 4480;

type SpreadPosition = {
  id: StoicheionPracticeSectorId;
  direction: string;
  shortDirection: string;
  meaning: string;
};

const SPREAD_POSITIONS: readonly SpreadPosition[] = [
  {
    id: "northwest",
    direction: "Северо-запад",
    shortDirection: "СЗ",
    meaning: "Мир границ, переходов и рискованных действий. Скрытые угрозы или внезапные прорывы.",
  },
  {
    id: "north",
    direction: "Север",
    shortDirection: "С",
    meaning: "Мир ужаса или глубокого познания. Способность вкушать опыт и переваривать сложные ситуации.",
  },
  {
    id: "northeast",
    direction: "Северо-восток",
    shortDirection: "СВ",
    meaning: "Мир завершения, смерти старого и рождения нового. Интуитивное чутьё и материальные ценности.",
  },
  {
    id: "west",
    direction: "Запад",
    shortDirection: "З",
    meaning: "Мир опьянения, иллюзий и глубокого видения. Зависимости и способность видеть истину сквозь морок.",
  },
  {
    id: "center",
    direction: "Центр",
    shortDirection: "Ц",
    meaning: "Духовность, координация всех сфер и связь с вечностью. Точка сборки всей ситуации.",
  },
  {
    id: "east",
    direction: "Восток",
    shortDirection: "В",
    meaning: "Мир магии, созидания и интеллекта. Здесь, подобно восходящему Солнцу, зарождаются идеи и планы.",
  },
  {
    id: "southwest",
    direction: "Юго-запад",
    shortDirection: "ЮЗ",
    meaning: "Мир ярости, скрытых возможностей и трансформации через страдание. Сектор преодоления препятствий.",
  },
  {
    id: "south",
    direction: "Юг",
    shortDirection: "Ю",
    meaning: "Мир войны, активной деятельности и логического ума. Дисциплина, борьба и прямое действие.",
  },
  {
    id: "southeast",
    direction: "Юго-восток",
    shortDirection: "ЮВ",
    meaning: "Мир дикой природы и проявления Эго. Инстинкты, первичные импульсы и необузданная сила.",
  },
] as const;

const PREVIEW_POSITIONS = [
  SPREAD_POSITIONS[1],
  SPREAD_POSITIONS[2],
  SPREAD_POSITIONS[5],
  SPREAD_POSITIONS[0],
  SPREAD_POSITIONS[4],
  SPREAD_POSITIONS[8],
  SPREAD_POSITIONS[3],
  SPREAD_POSITIONS[6],
  SPREAD_POSITIONS[7],
] as const;

function localDayKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toClientDraw(record: StoicheionDrawRecord): ClientDrawRecord {
  return {
    ...record,
    seed: record.seed >>> 0,
    localDeadline: record.canReroll && record.remainingSeconds > 0
      ? Date.now() + record.remainingSeconds * 1000
      : 0,
  };
}

function formatCountdown(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function readLocalDraws(dayKey: string): Partial<Record<StoicheionDrawKind, StoicheionDrawRecord>> {
  const result: Partial<Record<StoicheionDrawKind, StoicheionDrawRecord>> = {};
  try {
    const start=stoicheionWeekStart(dayKey);
    for(let offset=0;offset<7;offset++){
      const date=new Date(start+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset);const key=date.toISOString().slice(0,10);if(key>dayKey)break;
      const parsed=JSON.parse(localStorage.getItem(`${LOCAL_DRAW_STORAGE_PREFIX}${key}`)||"{}") as Partial<Record<StoicheionDrawKind,StoicheionDrawRecord>>;
      for(const kind of ["daily","spread"] as const){
        const draw=parsed[kind];if(kind==='daily'&&key!==dayKey||!draw||draw.dayKey!==key||draw.kind!==kind||![1,2].includes(draw.attempts))continue;
        const remainingSeconds=draw.attempts===1?Math.max(0,Math.ceil((Date.parse(draw.rerollDeadline)-Date.now())/1000)):0;
        result[kind]={...draw,seed:draw.seed>>>0,remainingSeconds,canReroll:draw.attempts===1&&remainingSeconds>0};
      }
    }
  } catch {
    // An unreadable older draw does not invalidate the independent timeline.
  }
  const timeline = readLocalTimelineDraw(localStorage, dayKey);
  if (timeline) result.timeline = timeline;
  return result;
}

function saveLocalDraw(kind: StoicheionDrawKind, seed: number, dayKey: string): StoicheionDrawRecord {
  if (privateDeviceAccessBlocked()) throw new Error("AUTH_REQUIRED");
  if (kind === "timeline") return saveLocalTimelineDraw(localStorage, seed, dayKey);
  const current = readLocalDraws(dayKey);
  const existing = current[kind];
  if (existing && (!existing.canReroll || existing.attempts >= 2)) {
    throw new Error(existing.attempts >= 2 ? "Переброс на сегодня уже использован." : "Трёхминутное окно для переброса завершилось.");
  }
  const now = new Date();
  const firstDrawAt = existing?.firstDrawAt ?? now.toISOString();
  const deadline = existing?.rerollDeadline ?? new Date(now.getTime() + 180_000).toISOString();
  const record: StoicheionDrawRecord = {
    kind,
    dayKey: existing?.dayKey ?? dayKey,
    seed: seed >>> 0,
    attempts: existing ? 2 : 1,
    firstDrawAt,
    rerollDeadline: deadline,
    remainingSeconds: existing ? 0 : 180,
    canReroll: !existing,
  };
  const key=`${LOCAL_DRAW_STORAGE_PREFIX}${record.dayKey}`;
  const stored=JSON.parse(localStorage.getItem(key)||"{}");
  localStorage.setItem(key, JSON.stringify({ ...stored, [kind]: record }));
  return record;
}

export function mixStoicheionEntropy(seed: number, x: number, y: number, time: number) {
  let value = seed ^ Math.imul(Math.round(x * 100), 0x45d9f3b);
  value ^= Math.imul(Math.round(y * 100), 0x119de1f3);
  value ^= time | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function selectStoicheionCard<T>(cards: readonly T[], entropy: number) {
  if (!cards.length) return null;
  return cards[entropy % cards.length];
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function buildStoicheionSpread<T>(cards: readonly T[], seed: number, size = 9) {
  const pool = [...cards];
  const random = seededRandom(seed ^ 0xa511e9b3);
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, Math.min(size, pool.length));
}

export function isStoicheionCardReversed(seed: number, position = 0) {
  const orientationSeed = (seed ^ Math.imul(position + 1, 0x27d4eb2d)) >>> 0;
  return seededRandom(orientationSeed)() < 0.5;
}

export function buildStoicheionSpreadReading<T>(cards: readonly T[], seed: number, size = 9) {
  return buildStoicheionSpread(cards, seed, size).map((letter, index) => ({
    letter,
    reversed: isStoicheionCardReversed(seed, index + 1),
  }));
}

function orientationLabel(reversed: boolean) {
  return reversed ? "Перевёрнутое положение" : "Парадное положение";
}

export function pythmenFromTotal(total: number) {
  return total === 0 ? 0 : 1 + ((total - 1) % 9);
}

function pythmenTrace(total: number) {
  const steps = [total];
  let value = total;
  while (value > 9) {
    value = String(value)
      .split("")
      .reduce((sum, digit) => sum + Number(digit), 0);
    steps.push(value);
  }
  return steps;
}

function LetterDetails({
  letter,
  reversed,
  position,
  timeline,
  onClose,
  onOpenTheokyklosSector,
  onChooseSacredPractice,
  startedPracticeIds = [],
  sacredPracticesEnabled,
  onStartRestoration,
  restorationAction = "begin",
}: {
  letter: StoicheionLetter;
  reversed: boolean | null;
  position: SpreadPosition | null;
  timeline?: StoicheionTimePosition;
  onClose: () => void;
  onOpenTheokyklosSector?: (sectorId: StoicheionPracticeSectorId) => void;
  onChooseSacredPractice?: (practiceId: string) => void | Promise<void>;
  startedPracticeIds?: string[];
  sacredPracticesEnabled: boolean;
  onStartRestoration?: (sectorId: StoicheionPracticeSectorId) => void;
  restorationAction?: RestorationPrimaryState;
}) {
  const language = getRuntimeLanguage();
  const restorationText = restorationCopy(language);
  const timeCopy = stoicheionTimelineCopy(language);
  const restorationSector = RESTORATION_SECTORS.find(item => item.id === position?.id);
  const sector = position ? THEOKYKLOS_SEGMENTS.find((segment) => segment.id === position.id) ?? null : null;
  const guidance = position ? sacredSectorGuidance(position.id) : null;
  const practices = position ? sacredPracticesForSector(position.id) : [];
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [practiceError, setPracticeError] = useState("");
  const sections = stoicheionReadingSections(formatGreekTerms(letter.content, getRuntimeLanguage()));
  const readingText=splitStoicheionReading(formatGreekTerms(letter.content,language),letter.id);
  const orientationSections=[{heading:translateText('Парадное положение',language),body:readingText.upright},
    {heading:translateText('Перевёрнутое положение',language),body:readingText.reversed}];
  const profileSections=stoicheionReadingSections(readingText.profile);
  const drawReading = reversed !== null;
  const [readingMoreOpen, setReadingMoreOpen] = useState(orientationSections.length === 0);
  const renderSection = (section: (typeof sections)[number], index: number) => {
    const selected = reversed !== null && section===orientationSections[reversed?1:0];
    return <section className={drawReading && selected ? "stoicheion-reading-selected" : undefined} key={`${letter.id}-${index}`}>
      {section.heading ? <h3 data-no-translate>{section.heading}</h3> : null}
      <div className="stoicheion-reading-body" data-no-translate>{section.body.split(/\n{2,}/).filter(Boolean).map((paragraph,bodyIndex)=>{
        const lines=paragraph.split("\n");const list=lines.every(line=>/^\s*-\s|^(Корень|Заклинание|Ассоциативный цвет|Цветовая гамма|Божество|Центр в теле|Медитация|Магическая поза|Работа с телом|Root|Incantation|Color|Deity|Body center|Meditation|Magical pose|Body work):/.test(line));
        return list ? <ul key={bodyIndex}>{lines.map((line,lineIndex)=><li key={lineIndex}>{line.replace(/^\s*-\s*/,"")}</li>)}</ul> : <p key={bodyIndex}>{paragraph}</p>;
      })}</div>
    </section>;
  };
  const practiceActions = (recommended = false) => <div className="stoicheion-sector-habits">
    <h3>{translateText(recommended ? "Рекомендуемые действия" : "Сакральные привычки", language)}</h3>
    <p>{translateText("Однократное действие", language)}</p>
    {practiceError ? <p role="alert">{practiceError}</p> : null}
    {practices.map(practice => <div key={practice.id}>
      {!startedPracticeIds.includes(practice.id) ? <p data-no-translate>{habitPracticeCopy[language].warning}</p> : null}
      <button type="button" className="stoicheion-practice-action"
        disabled={practiceBusy || !sacredPracticesEnabled || (!onChooseSacredPractice && !onOpenTheokyklosSector)}
        onClick={async () => {
          if (practiceBusy) return;
          setPracticeBusy(true); setPracticeError("");
          try {
            if (onChooseSacredPractice) await onChooseSacredPractice(practice.id);
            else if (position) onOpenTheokyklosSector?.(position.id);
            onClose();
          } catch { setPracticeError(translateText("Не удалось сохранить практику.", language)); }
          finally { setPracticeBusy(false); }
        }}>
        <span aria-hidden="true">{practice.emoji}</span><span className="stoicheion-practice-copy" data-no-translate><strong>{catalogText(practice.title, language)}</strong><span>{catalogText(practice.description, language)}</span>
          <b>{translateText(startedPracticeIds.includes(practice.id) ? "Открыть привычку" : "Начать практику", language)}</b></span><ExperimentalIcon name="chevron" />
      </button>
    </div>)}
    {!sacredPracticesEnabled ? <p>{translateText("Трекинг привычек отключён в личном кабинете. Практики видны, но их нельзя начинать или отмечать.", language)}</p> : null}
  </div>;
  const sectorPractice = position && sector && guidance ? (
    <section className={`stoicheion-sector-practice${reversed ? " is-reversed" : ""}`}>
      <header>
        <span aria-hidden="true">{sector.symbol}</span>
        <div><small>{language === "en" ? "Practice of the spread sector" : "Практика сектора расклада"}</small><h3>{position.direction} · <span data-no-translate>{catalogText(sector.patrons, language)}</span></h3></div>
      </header>
      <p data-no-translate>{catalogText(guidance[reversed ? "reversed" : "upright"], language)}</p>
      <div className="stoicheion-sector-words">
        <small>{language === "en" ? "Sacred words" : "Священные слова"}</small>
        <div>{sector.words.map((word) => <span key={word.greek} data-no-translate><b lang={language === "el" ? "grc" : language}>{sacredWordCopy(word.greek, language, word.pronunciation.ru)}</b><em>{catalogText(word.pronunciation, language)}</em></span>)}</div>
      </div>
      {onOpenTheokyklosSector ? <button type="button" className="secondary-button" onClick={() => { onClose(); onOpenTheokyklosSector(position.id); }}>{language === "en" ? "Open the Theokyklos sector" : "Открыть сектор Теокиклоса"}<ExperimentalIcon name="chevron" /></button> : null}
    </section>
  ) : null;
  const dialogRef = useDialogAccessibility<HTMLDivElement>(onClose);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return createPortal(
    <div
      className="stoicheion-letter-dialog"
      data-dialog-header="none"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`letter-${letter.id}-title`}
      tabIndex={-1}
    >
      <article>
        <DialogCloseButton type="button" className="stoicheion-dialog-close" onClick={onClose} aria-label="Закрыть описание буквы" />
        <header>
          <StoicheionCardFace letter={letter} reversed={Boolean(reversed)} variant="dialog" />
          <div>
            <span className="eyebrow">{String(letter.order).padStart(2, "0")} · значение {letter.value} · Пифмен {letter.pythmen}</span>
            <h2 id={`letter-${letter.id}-title`} data-no-translate>{letter.name}</h2>
            <p data-no-translate>{letter.tagline}</p>
            {reversed !== null ? (
              <mark className={`stoicheion-dialog-orientation${reversed ? " is-reversed" : ""}`}>
                {orientationLabel(reversed)}
              </mark>
            ) : null}
          </div>
        </header>
        <div className="stoicheion-letter-copy">
          {timeline ? <section className="stoicheion-time-reading" data-no-translate>
            <h3>{timeline.title}</h3><p>{timeline.meaning}</p>
            <p>{reversed ? timeCopy.reversedEffect : timeCopy.uprightEffect}</p>
          </section> : null}
          {drawReading?<div className="stoicheion-orientation-readings">{orientationSections.map(renderSection)}</div>:null}
          {position ? <section className="stoicheion-spread-position">
            <span className="eyebrow">{language === "en" ? "Spread sector" : "Сектор расклада"}</span>
            <h3>{sector ? catalogText(sector.title, language) : position.direction}</h3>
            {sector ? <strong data-no-translate>{catalogText(sector.patrons, language)}</strong> : null}
            <p>{position.meaning}</p>
            {restorationSector ? <p data-no-translate>{restorationLocal(restorationSector.ambivalence, language)}</p> : null}
            {sector ? <p data-no-translate>{catalogText(sector.description, language)}</p> : null}
          </section> : null}
          {drawReading ? <>
            {sectorPractice}
            <details className="stoicheion-reading-more" open={readingMoreOpen} onToggle={event => setReadingMoreOpen(event.currentTarget.open)}>
              <summary>{translateText("Полная информация о карте", language)}</summary>
              <div>{profileSections.map(renderSection)}</div>
            </details>
            {position?<section className="stoicheion-recommended-practices">{practiceActions(true)}
              {reversed&&onStartRestoration?<StoicheionActionButton icon="restoration" className="primary-button" data-no-translate disabled={restorationAction === "preparing"} onClick={() => { onClose(); requestAnimationFrame(() => onStartRestoration(position.id)); }}>{restorationText[restorationAction]}</StoicheionActionButton>:null}</section>:null}
          </> : <>{sections.map(renderSection)}{sectorPractice}{position?practiceActions():null}</>}
        </div>
      </article>
    </div>,
    document.body,
  );
}

type StoicheionViewProps = {
  onModelingTask?: (value: AuroraTaskRequest) => void;
  userId?: string;
  workspace?: HabitWorkspace;
  calendarMode?: CalendarMode;
  todayDate?: string;
  onWorkspaceChange?: (workspace: HabitWorkspace) => void | Promise<void>;
  onOpenHabits?: () => void;
  divinationDisabled?: boolean;
  onOpenTheokyklosSector?: (sectorId: StoicheionPracticeSectorId) => void;
  onChooseSacredPractice?: (practiceId: string) => void;
  sacredPracticesEnabled?: boolean;
  initialCardId?: string | null;
  onInitialCardOpened?: () => void;
  voiceDrawKind?: "daily" | "spread" | null;
  onVoiceDrawHandled?: () => void;
};

export function StoicheionView({ divinationDisabled = false, onOpenTheokyklosSector,
  onModelingTask,
  onChooseSacredPractice, sacredPracticesEnabled = true,
  workspace, calendarMode = "sacred", todayDate, userId = "", onWorkspaceChange, onOpenHabits,
  initialCardId = null, onInitialCardOpened, voiceDrawKind = null, onVoiceDrawHandled }: StoicheionViewProps) {
  const locale = runtimeLocale();
  const language = getRuntimeLanguage();
  const letters = useMemo(() => getStoicheionLetters(language), [language]);
  const entropy = useRef(INITIAL_ENTROPY);
  const motionTracker = useRef<MotionTracker | null>(null);
  const motionField = useRef<HTMLButtonElement | null>(null);
  const handledVoiceDraw = useRef<"daily" | "spread" | null>(null);
  const timelineAllowed=featureAllowed(currentFeatureAccess(userId),'stoicheion-timeline');
  const spreadAllowed=featureAllowed(currentFeatureAccess(userId),'stoicheion-spread');
  const restorationAllowed=featureAllowed(currentFeatureAccess(userId),'stoicheion-restoration');
  const drawAllowed=(kind:StoicheionDrawKind)=>featureAllowed(currentFeatureAccess(userId),
    kind==='spread'?'stoicheion-spread':kind==='timeline'?'stoicheion-timeline':'stoicheion');
  const blockedDraw=(kind:StoicheionDrawKind)=>requestUpgrade({feature:kind==='spread'?'stoicheion-spread':kind==='timeline'?'stoicheion-timeline':'stoicheion',reason:'feature'});

  const [pointer, setPointer] = useState({ x: 50, y: 24 });
  const [dailyDraw, setDailyDraw] = useState<ClientDrawRecord | null>(null);
  const [spreadDraw, setSpreadDraw] = useState<ClientDrawRecord | null>(null);
  const [timelineDraw, setTimelineDraw] = useState<ClientDrawRecord | null>(null);
  const [timelineRevealed, setTimelineRevealed] = useState(0);
  const [timelineSession,setTimelineSession]=useState<ClientTimelineRecord|null>(null);
  const [timelineClock,setTimelineClock]=useState(()=>performance.now());
  const acceptTimeline=useCallback((record:StoicheionTimelineRecord|null,started:number)=>{
    const received=performance.now();
    setTimelineSession(record?receiveTimeline(record,received,received-started):null);
    setTimelineRevealed(record?.cards.length??0);
    setTimelineDraw(record?toClientDraw({kind:"timeline",dayKey:record.dayKey,seed:record.seed,attempts:1,
      firstDrawAt:record.firstDrawAt,rerollDeadline:record.firstDrawAt,remainingSeconds:0,canReroll:false}):null);
    setTimelineClock(received);
  },[]);
  const [testingAccess,setTestingAccess]=useState(false);
  const [motion, setMotion] = useState<{ mode: MotionMode; progress: number; replaceCurrent: boolean; position?:number } | null>(null);
  const [selectedReading, setSelectedReading] = useState<SelectedReading | null>(null);
  const restorationRef = useRef<RestorationHandle>(null);
  const [restorationPrimary, setRestorationPrimary] = useState<RestorationPrimaryState>("preparing");
  const [timelineHelpOpen, setTimelineHelpOpen] = useState(false);
  const restorationText = restorationCopy(language);
  const timeCopy = stoicheionTimelineCopy(language);
  const startRestoration = (sectorId: string | null) => {
    if (!featureAllowed(currentFeatureAccess(userId),"stoicheion-restoration")) { requestUpgrade({feature:"stoicheion-restoration",reason:"feature"}); return; }
    restorationRef.current?.activate(sectorId);
  };
  const beginPractice = async (id: string) => {
    const practice = SACRED_PRACTICES.find(item => item.id === id);
    if (workspace && onWorkspaceChange && practice && sacredPracticesEnabled) {
      if (!findStandardSacredHabit(workspace.habits, id)) {
        const habit = createHabitFromSacredPractice(practice, todayDate ?? localDayKey(new Date()), calendarMode, language);
        await onWorkspaceChange({ ...workspace, habits: [...workspace.habits, habit] });
      }
      onOpenHabits?.();
    } else await onChooseSacredPractice?.(id);
  };
  useEffect(() => {
    if (!initialCardId) return;
    const letter = letters.find((candidate) => candidate.id === initialCardId);
    if (!letter) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setSelectedReading({ letter, reversed: null, position: null });
      onInitialCardOpened?.();
    });
    return () => { active = false; };
  }, [initialCardId, letters, onInitialCardOpened]);
  const [drawsReady, setDrawsReady] = useState(false);
  const [savingKind, setSavingKind] = useState<MotionMode | null>(null);
  const [drawError, setDrawError] = useState("");
  const [drawErrorKind, setDrawErrorKind] = useState<MotionMode>("daily");
  const [clock, setClock] = useState(() => Date.now());
  const today = useMemo(() => new Date(), []);
  const dayKey = useMemo(() => localDayKey(today), [today]);
  const dateLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(today),
    [locale, today],
  );
  const motionActive = motion !== null;

  useEffect(() => {
    if (!motionActive) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => motionField.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
    };
  }, [motionActive]);

  useEffect(() => {
    if (divinationDisabled) return;
    let active = true;
    const load = async () => {
      try {
        const started=performance.now();
        const result = isGoogleSyncConfigured
          ? await loadStoicheionDraws()
          : { dayKey, draws: readLocalDraws(dayKey), testingAccess:false };
        if (!active) return;
        setTestingAccess(result.testingAccess===true);
        setDailyDraw(result.draws.daily ? toClientDraw(result.draws.daily) : null);
        setSpreadDraw(result.draws.spread ? toClientDraw(result.draws.spread) : null);
        if(isGoogleSyncConfigured&&timelineAllowed){
          const saved=await loadStoicheionTimelineCards();
          if(!active)return;
          acceptTimeline(saved.timeline,started);
        }else acceptTimeline(null,started);
        setDrawError("");
      } catch (error) {
        if (!active) return;
        setDrawErrorKind("daily");
        setDrawError(error instanceof Error ? error.message : "Не удалось загрузить расклады.");
      } finally {
        if (active) setDrawsReady(true);
      }
    };
    void load();
    return () => { active = false; };
  }, [dayKey, divinationDisabled, userId, timelineAllowed, acceptTimeline]);

  useEffect(() => {
    if (![dailyDraw, spreadDraw].some((draw) => draw?.attempts === 1 && draw.localDeadline > Date.now())
      && !timelineSession?.cards.some(card=>timelineCardSeconds(card,performance.now())>0)) return;
    const timer = window.setInterval(() => {setClock(Date.now());setTimelineClock(performance.now());}, 1000);
    return () => window.clearInterval(timer);
  }, [dailyDraw, spreadDraw, timelineSession]);

  const dailyLetter = dailyDraw ? selectStoicheionCard(letters, dailyDraw.seed) : null;
  const modelingInIntro = useSyncExternalStore(subscribeModelingDesktop, modelingDesktopSnapshot, modelingServerSnapshot) && !!spreadDraw && !divinationDisabled;
  const dailyReversed = dailyDraw ? isStoicheionCardReversed(dailyDraw.seed) : false;
  const spreadSeed = spreadDraw?.seed ?? null;
  const spreadCards = useMemo(
    () => spreadSeed === null ? [] : buildStoicheionSpreadReading(letters, spreadSeed),
    [letters, spreadSeed],
  );
  const spreadLetters = spreadCards.map((card) => card.letter);
  const modelingPrimary = useMemo(() => spreadDraw ? snapshotFromSavedDraw({
    id: `stoicheion-${spreadDraw.dayKey}-${spreadDraw.seed}`, seed: spreadDraw.seed, day: spreadDraw.dayKey,
    createdAt: spreadDraw.firstDrawAt, cards: spreadCards.map(card => ({cardId:card.letter.id,reversed:card.reversed})),
  }) : null, [spreadDraw, spreadCards]);
  const spreadVisible = spreadSeed !== null;
  const spreadTotal = spreadLetters.reduce((sum, letter) => sum + letter.value, 0);
  const spreadPythmen = pythmenFromTotal(spreadTotal);
  const spreadTrace = pythmenTrace(spreadTotal);
  const dailyRemaining = dailyDraw?.attempts === 1 ? Math.max(0, Math.ceil((dailyDraw.localDeadline - clock) / 1000)) : 0;
  const spreadRemaining = spreadDraw?.attempts === 1 ? Math.max(0, Math.ceil((spreadDraw.localDeadline - clock) / 1000)) : 0;
  const dailyCanReroll = Boolean(dailyDraw?.unlimited || dailyDraw?.attempts === 1 && dailyRemaining > 0);
  const spreadCanReroll = Boolean(spreadDraw?.unlimited || spreadDraw?.attempts === 1 && spreadRemaining > 0);
  const timelineCards = useMemo(() => timelineDraw ? buildStoicheionSpreadReading(letters, timelineDraw.seed, 3) : [],
    [letters, timelineDraw]);
  const modelingTemporal = useMemo(() => timelineDraw && timelineRevealed === 3 ? createTemporalTriad({
    id: `stoicheion-timeline-${timelineDraw.dayKey}-${timelineDraw.seed}`, seed: timelineDraw.seed, createdAt: timelineDraw.firstDrawAt,
  }) : null, [timelineDraw, timelineRevealed]);

  const gatherEntropy = (event: PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.min(100, Math.max(0, ((event.clientY - bounds.top) / bounds.height) * 100));
    entropy.current = mixStoicheionEntropy(entropy.current, x, y, event.timeStamp);
    setPointer({ x, y });
  };

  const persistDraw = async (kind: "daily"|"spread", seedValue: number, replaceCurrent: boolean) => {
    if (!drawAllowed(kind)) { blockedDraw(kind); return; }
    let seed = seedValue >>> 0;
    if (kind === "daily" && replaceCurrent && selectStoicheionCard(letters, seed)?.id === dailyLetter?.id) {
      seed = (seed + 1) >>> 0;
    }
    if (kind === "spread" && replaceCurrent && seed === spreadDraw?.seed) {
      seed = (seed + 1) >>> 0;
    }
    setSavingKind(kind);
    setDrawError("");
    try {
      const record = isGoogleSyncConfigured
        ? (await saveStoicheionDraw(kind, seed)).draw
        : saveLocalDraw(kind, seed, dayKey);
      const clientRecord = toClientDraw(record);
      if (kind === "daily") {
        setDailyDraw(clientRecord);
      } else if (kind === "spread") {
        setSpreadDraw(clientRecord);
      }
      setSelectedReading(null);
      setClock(Date.now());
    } catch (error) {
      setDrawErrorKind(kind);
      setDrawError(error instanceof Error ? error.message : "Не удалось сохранить расклад.");
    } finally {
      setSavingKind(null);
    }
  };

  const persistTimelineCard=async(position:number,reroll:boolean)=>{
    if(!timelineAllowed||!isGoogleSyncConfigured||savingKind)return;
    setSavingKind("timeline");setDrawError("");
    const started=performance.now();
    try {
      const result=await changeStoicheionTimelineCard(position,reroll?"reroll":"reveal",timelineSession?.revision??0);
      acceptTimeline(result.timeline,started);setSelectedReading(null);
    } catch(error) {
      const code=error instanceof Error?error.message:"";
      const message=code.includes("TIMELINE_REROLL_USED")?timeCopy.rerollUsed:code.includes("TIMELINE_REROLL_EXPIRED")?timeCopy.rerollExpired
        :code.includes("TIMELINE_ORDER")?timeCopy.waiting:code.includes("TIMELINE_STALE")?timeCopy.changed:code;
      setDrawErrorKind("timeline");setDrawError(message||translateText("Не удалось сохранить расклад.",language));
      const refreshStarted=performance.now();
      try{acceptTimeline((await loadStoicheionTimelineCards()).timeline,refreshStarted);}catch{/* A failed refresh never grants a local attempt. */}
    } finally {setSavingKind(null);}
  };

  useEffect(() => {
    if (!voiceDrawKind) { handledVoiceDraw.current = null; return; }
    if (handledVoiceDraw.current === voiceDrawKind) return;
    if (divinationDisabled) {
      handledVoiceDraw.current = voiceDrawKind;
      onVoiceDrawHandled?.();
      return;
    }
    if (!drawsReady) return;
    handledVoiceDraw.current = voiceDrawKind;
    onVoiceDrawHandled?.();
    const existing = voiceDrawKind === "daily" ? dailyDraw : spreadDraw;
    if (existing || savingKind) return;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    queueMicrotask(() => { void persistDraw(voiceDrawKind, seed, false); });
  });

  const beginMotion = (mode: MotionMode, replaceCurrent = false, eventTime = 0, position?:number) => {
    if (!drawAllowed(mode)) { blockedDraw(mode); return; }
    if (divinationDisabled) return;
    if(mode==="timeline"&&!isGoogleSyncConfigured)return;
    const existing = mode === "daily" ? dailyDraw : mode === "spread" ? spreadDraw : timelineDraw;
    const canReroll = mode === "daily" ? dailyCanReroll : mode === "spread" ? spreadCanReroll : timelineCardSeconds(timelineSession?.cards[position??0],performance.now())>0;
    const revealNext = mode === "timeline" && existing && timelineRevealed < 3;
    if ((!replaceCurrent && existing && !revealNext) || (replaceCurrent && (!existing || !canReroll)) || savingKind || motionTracker.current) return;
    const baseSeed = mode === "spread"
      ? (dailyDraw?.seed ?? entropy.current) ^ Math.imul(dailyLetter?.value ?? 1, 0x45d9f3b)
      : entropy.current ^ (replaceCurrent ? (existing?.seed ?? 0) : 0);
    const seed = mixStoicheionEntropy(baseSeed, pointer.x, pointer.y, eventTime);
    motionTracker.current = {
      mode,
      seed,
      travel: 0,
      lastX: null,
      lastY: null,
      replaceCurrent,
      position,
    };
    setMotion({ mode, progress: 0, replaceCurrent,position });
  };

  const finishMotion = (tracker: MotionTracker) => {
    motionTracker.current = null;
    setMotion(null);
    entropy.current = tracker.seed;
    if (tracker.mode === "timeline") {
      void persistTimelineCard(tracker.position??timelineRevealed,tracker.replaceCurrent);
      return;
    }
    if (tracker.mode === "daily") {
      void persistDraw("daily", tracker.seed, tracker.replaceCurrent);
      return;
    }
    const seed = mixStoicheionEntropy(
      tracker.seed ^ (dailyDraw?.seed ?? INITIAL_ENTROPY) ^ Math.imul(dailyLetter?.value ?? 1, 0x119de1f3),
      pointer.x,
      pointer.y,
      tracker.travel,
    );
    void persistDraw(tracker.mode, seed, tracker.replaceCurrent);
  };

  const addMotion = (x: number, y: number, time: number, distance: number) => {
    const tracker = motionTracker.current;
    if (!tracker) return;
    tracker.seed = mixStoicheionEntropy(tracker.seed, x, y, time);
    tracker.travel += Math.min(Math.max(distance, 0), 70);
    const progress = Math.min(100, Math.round((tracker.travel / MOTION_TRAVEL_REQUIRED) * 100));
    setMotion({ mode: tracker.mode, progress, replaceCurrent: tracker.replaceCurrent,position:tracker.position });
    if (tracker.travel >= MOTION_TRAVEL_REQUIRED) finishMotion(tracker);
  };

  const moveThroughField = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const tracker = motionTracker.current;
    if (!tracker) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.min(100, Math.max(0, ((event.clientY - bounds.top) / bounds.height) * 100));
    const distance = tracker.lastX === null || tracker.lastY === null
      ? 0
      : Math.hypot(event.clientX - tracker.lastX, event.clientY - tracker.lastY);
    tracker.lastX = event.clientX;
    tracker.lastY = event.clientY;
    setPointer({ x, y });
    addMotion(x, y, event.timeStamp, distance);
  };

  const startTouchMotion = (event: PointerEvent<HTMLButtonElement>) => {
    const tracker = motionTracker.current;
    if (!tracker) return;
    tracker.lastX = event.clientX;
    tracker.lastY = event.clientY;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; movement still works without it.
    }
  };

  const moveWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) return;
    event.preventDefault();
    const offsets: Record<string, [number, number]> = {
      ArrowUp: [0, -11],
      ArrowDown: [0, 11],
      ArrowLeft: [-11, 0],
      ArrowRight: [11, 0],
      " ": [7, 7],
    };
    const [dx, dy] = offsets[event.key];
    const x = Math.min(100, Math.max(0, pointer.x + dx));
    const y = Math.min(100, Math.max(0, pointer.y + dy));
    setPointer({ x, y });
    addMotion(x, y, event.timeStamp, 48);
  };

  const cancelMotion = () => {
    motionTracker.current = null;
    setMotion(null);
  };
  const motionDialogRef = useDialogAccessibility<HTMLDivElement>(cancelMotion, motionActive);

  return (
    <div className="stoicheion-section-view">
        <header className="theokyklos-hero stoicheion-intro">
          <div className="theokyklos-hero-copy">
            <span className="eyebrow">Гно · Метэр · Басилея</span>
            <h1 id="stoicheion-title">Стойхейон</h1>
            <p>{divinationDisabled
              ? "Двадцать четыре буквенных образа и их метафизические значения."
              : "Двадцать четыре буквенных образа, карта дня и «Космический круг» — расклад девяти ликов силы."}</p>
          </div>
          <div className="section-hero-art section-hero-art-hermes" aria-hidden="true" />
        </header>
    <section
      className="stoicheion-view"
      data-genesis-preserve="stoicheion"
      aria-labelledby="stoicheion-title"
      onPointerMove={gatherEntropy}
      style={{ "--stoicheion-x": `${pointer.x}%`, "--stoicheion-y": `${pointer.y}%` } as CSSProperties}
    >
      <div className="stoicheion-orbit-frame" aria-hidden="true">
      <div className="stoicheion-orbit" aria-hidden="true">
        {letters.map((letter, index) => (
          <i key={letter.id} style={{ "--letter-index": index } as CSSProperties}>{letter.symbol}</i>
        ))}
      </div>

      </div>



      <div className="stoicheion-inner">
        {divinationDisabled ? (
          <section className="stoicheion-divination-disabled" aria-labelledby="stoicheion-divination-disabled-title">
            <span aria-hidden="true">⊘</span>
            <div>
              <span className="eyebrow">Настройка личного кабинета</span>
              <h2 id="stoicheion-divination-disabled-title">Гадания по картам выключены</h2>
              <p>Вы запретили себе гадания в личном кабинете. Карта дня и расклад девяти карт скрыты, но все буквенные карты и их значения остаются доступны ниже.</p>
            </div>
          </section>
        ) : (
          <>
        <section className={`stoicheion-day-section${dailyLetter ? " has-draw" : ""}`} aria-labelledby="stoicheion-day-title">
          <div className="stoicheion-section-intro">
            <span className="eyebrow">Первое взаимодействие · {dateLabel}</span>
            <h2 id="stoicheion-day-title">Карта дня</h2>
            <p>Выбор открывает одну из 24 авторских карт. Случайность собирается на устройстве и фиксируется на текущий день.</p>
          </div>

          {drawError && drawErrorKind === "daily" ? <p className="stoicheion-draw-error" role="alert">{drawError}</p> : null}

          {!dailyLetter ? (
            <button
              type="button"
              className="stoicheion-card-back"
              onClick={(event) => beginMotion("daily", false, event.timeStamp)}
              disabled={!drawsReady || savingKind !== null}
              aria-label="Начать выбор случайной буквы дня движением"
            >
              <span aria-hidden="true"><i>24</i></span>
              <strong>{drawsReady ? "Начать выбор" : "Подготовка…"}</strong>
              <small>затем поводите мышью или пальцем</small>
            </button>
          ) : (
            <div className="stoicheion-daily-result" aria-live="polite">
              <button
                type="button"
                className={`stoicheion-revealed-card${dailyReversed ? " is-reversed" : ""}`}
                onClick={() => setSelectedReading({ letter: dailyLetter, reversed: dailyReversed, position: null })}
                aria-label={`${dailyLetter.name}, ${orientationLabel(dailyReversed)}. Открыть полное описание`}
              >
                <StoicheionCardFace letter={dailyLetter} reversed={dailyReversed} variant="daily" />
                <b className="stoicheion-card-orientation">{orientationLabel(dailyReversed)}</b>
              </button>
              <div>
                <span className="eyebrow">Ваш знак на сегодня</span>
                <h3>{dailyLetter.tagline}</h3>
                <p>Выбор сохранён. Нажмите на букву, чтобы прочитать полное описание, или продолжите к раскладу девяти ликов.</p>
                <div className="stoicheion-result-actions">
                  <StoicheionActionButton icon="read" data-no-translate onClick={() => setSelectedReading({ letter: dailyLetter, reversed: dailyReversed, position: null })}>{restorationText.readLetter}</StoicheionActionButton>
                  <StoicheionActionButton icon="reroll" data-no-translate disabled={!dailyCanReroll || savingKind !== null} onClick={(event) => beginMotion("daily", true, event.timeStamp)}>
                    {dailyCanReroll ? dailyDraw?.unlimited ? restorationText.reroll : `${restorationText.reroll} · ${formatCountdown(dailyRemaining)}` : restorationText.rerollUsed}
                  </StoicheionActionButton>
                </div>
              </div>
            </div>
          )}
        </section>

        {dailyLetter ? (
          <section className="stoicheion-nine-section" aria-labelledby="stoicheion-nine-title">
            <header>
              <div>
                <span className="eyebrow">Прорицание по девяти картам</span>
                <h2 id="stoicheion-nine-title">Космический круг и девять ликов силы</h2>
                <p>Магический квадрат 3×3 соотносит девять букв со сторонами света и архетипами человеческого бытия. Расклад выводится из числового значения карты, записанного при выборе карты дня + вашего волевого воздействия.</p>
                <p className="stoicheion-period-rule" data-no-translate>{testingAccess ? timeCopy.testingRule : timeCopy.weeklyRule}</p>
                {modelingInIntro ? <FutureModelingGuide language={language} userId={userId} primary={modelingPrimary} temporal={modelingTemporal} onAddTask={onModelingTask} /> : null}
              </div>
              {spreadVisible ? <aside className="stoicheion-isopsephy" aria-labelledby="isopsephy-title">
                <span className="eyebrow">Исопсефия · числовое равенство</span>
                <h3 id="isopsephy-title">Пифмен расклада</h3>
                <p className="stoicheion-sum">{spreadLetters.map((letter) => letter.value).join(" + ")} = <strong>{spreadTotal}</strong></p>
                <div className="stoicheion-root-line">
                  <span>{spreadTrace.join(" → ")}</span>
                  <strong>{spreadPythmen}</strong>
                </div>
                <p>Сумма числовых значений девяти букв последовательно складывается до числового корня от 1 до 9.</p>
                <div className="stoicheion-spread-actions">
                    {restorationAllowed && workspace && onWorkspaceChange && spreadCards.some(card => card.reversed) ? <StoicheionActionButton icon="restoration" className="primary-button" data-no-translate disabled={restorationPrimary === "preparing"} onClick={() => startRestoration(null)}>{restorationText[restorationPrimary]}</StoicheionActionButton> : null}
                    <StoicheionActionButton icon="reroll" data-no-translate disabled={!spreadAllowed || !spreadCanReroll || savingKind !== null} onClick={(event) => beginMotion("spread", true, event.timeStamp)}>
                      {spreadCanReroll ? spreadDraw?.unlimited ? restorationText.rerollSpread : `${restorationText.rerollSpread} · ${formatCountdown(spreadRemaining)}` : restorationText.rerollUsed}
                    </StoicheionActionButton>
                </div>
              </aside> : null}
            </header>

            {!spreadAllowed ? <FeatureAccessUI language={language} feature="stoicheion-spread"/> : null}
            {drawError && drawErrorKind === "spread" ? <p className="stoicheion-draw-error" role="alert">{drawError}</p> : null}

            {spreadVisible ? (
              <div className="stoicheion-spread-reading" aria-live="polite">
                <div className="stoicheion-spread-grid" aria-label="Расклад из девяти букв">
                  {SPREAD_POSITIONS.map((position, index) => {
                    const card = spreadCards[index];
                    const letter = card.letter;
                    return (
                      <button
                        type="button"
                        className={`stoicheion-sector sector-${position.id}${card.reversed ? " is-reversed" : ""}`}
                        key={position.id}
                        onClick={() => setSelectedReading({ letter, reversed: card.reversed, position })}
                        aria-label={`${position.direction}: ${letter.name}, ${orientationLabel(card.reversed)}. ${position.meaning}`}
                      >
                        <span className="stoicheion-direction"><i>{position.shortDirection}</i>{position.direction}</span>
                        <StoicheionCardFace letter={letter} reversed={card.reversed} variant="spread" />
                        <small className="stoicheion-spread-card-label"><strong>{letter.name}</strong><span>{language === "en" ? "Value" : "Число"} {letter.value}</span></small>
                        <em>{orientationLabel(card.reversed)}</em>
                        <span className="stoicheion-sector-details-link">{language === "en" ? "Sector details" : "Описание сектора"} →</span>
                      </button>
                    );
                  })}
                </div>

              </div>
            ) : (
              <div className="stoicheion-nine-preview">
                <span className="stoicheion-compass-rose" aria-hidden="true" />
                <div aria-hidden="true">
                  {PREVIEW_POSITIONS.map((position) => <i key={position.id}>{position.id === "center" ? "" : position.shortDirection}</i>)}
                </div>
                <button type="button" className="primary-button stoicheion-preview-start" data-testid="stoicheion-spread-begin"
                  disabled={!spreadAllowed || savingKind !== null} onClick={(event) => beginMotion("spread", false, event.timeStamp)}>Начать расклад</button>
              </div>
            )}
          </section>
        ) : null}
          </>
        )}

        {!divinationDisabled ? <section className="stoicheion-nine-section stoicheion-timeline-section" aria-labelledby="stoicheion-timeline-title" data-no-translate>
          <header><div><h2 id="stoicheion-timeline-title">{timeCopy.title}</h2><p>{timeCopy.subtitle}</p><p className="stoicheion-period-rule">{timeCopy.weeklyRule}</p><p>{timeCopy.perCardRule}</p></div></header>
          {!timelineAllowed?<p role="status">{language==='en'?'Three-card divination is available with Standard and above.':translateText('Прорицание по трём картам доступно в Standart и выше.',language).replaceAll('Standart','Standard')}</p>:null}
          {drawError && drawErrorKind === "timeline" ? <p className="stoicheion-draw-error" role="alert">{translateText(drawError, language)}</p> : null}
          <div className="stoicheion-timeline-cards" aria-live="polite">
            {timeCopy.positions.map((position, index) => {
              const card = index < timelineRevealed ? timelineCards[index] : null;
              const next = index === timelineRevealed;
              const window=timelineSession?.cards[index],remaining=timelineCardSeconds(window,timelineClock);
              const canReroll=Boolean(card&&remaining>0);
              return <div className="stoicheion-timeline-slot" key={position.id}><button type="button" className={`stoicheion-timeline-card${card?.reversed ? " is-reversed" : ""}${card ? "" : " is-unopened"}`}
                data-testid={`stoicheion-timeline-${position.id}`} data-revealed={Boolean(card)}
                disabled={!card && (!next || !timelineAllowed || !drawsReady || !isGoogleSyncConfigured || savingKind !== null)}
                onClick={event => card ? setSelectedReading({ letter: card.letter, reversed: card.reversed, position: null, timeline: position }) : beginMotion("timeline", false, event.timeStamp,index)}
                aria-label={card ? `${position.title}: ${card.letter.name}, ${card.reversed ? timeCopy.reversed : timeCopy.upright}` : `${position.title}: ${next ? timeCopy.openCard : timeCopy.waiting}`}>
                <strong>{position.title}</strong>
                {card ? <><StoicheionCardFace letter={card.letter} reversed={card.reversed} variant="spread" />
                  <b>{card.letter.name}</b><span>{card.reversed ? timeCopy.reversed : timeCopy.upright}</span></>
                  : <><span className="stoicheion-card-back" aria-hidden="true"><span><i>24</i></span></span><b>{next ? timeCopy.openCard : timeCopy.waiting}</b></>}
              </button><button type="button" className="stoicheion-timeline-card-reroll" data-testid={`stoicheion-timeline-reroll-${position.id}`}
                disabled={!timelineAllowed||!canReroll||savingKind!==null} onClick={event=>beginMotion("timeline",true,event.timeStamp,index)}
                aria-label={`${position.title}: ${timeCopy.rerollCard}${canReroll?` · ${formatCountdown(remaining)}`:""}`}>
                <span>{window?.rerolled?timeCopy.rerollUsed:card&&!canReroll?timeCopy.rerollExpired:timeCopy.rerollCard}</span>
                {canReroll?<time>{formatCountdown(remaining)}</time>:null}
              </button></div>;
            })}
          </div>
          <div className="stoicheion-timeline-actions" data-restricted={!timelineAllowed}>
            {!timelineAllowed?<FeatureAccessUI language={language} feature="stoicheion-timeline"/>:null}
            <button type="button" className="secondary-button stoicheion-timeline-help" data-testid="stoicheion-timeline-help"
              aria-haspopup="dialog" aria-expanded={timelineHelpOpen} onClick={() => setTimelineHelpOpen(true)}>{timeCopy.method}</button>
          </div>
        </section> : null}

        {!divinationDisabled && restorationAllowed && workspace && onWorkspaceChange ? <StoicheionRestoration
          key={userId} ref={restorationRef} userId={userId} onPrimaryStateChange={setRestorationPrimary}
          cards={spreadVisible ? spreadCards.map(card => ({letterId:card.letter.id,reversed:card.reversed})) : []}
          sourceDate={spreadDraw?.dayKey ?? dayKey} sourceSeed={spreadSeed} today={todayDate ?? dayKey}
          workspace={workspace} calendarMode={calendarMode} onChange={onWorkspaceChange} onOpenHabits={onOpenHabits}
        /> : null}

        {!modelingInIntro && modelingPrimary ? <FutureModelingGuide language={language} userId={userId} primary={modelingPrimary} temporal={modelingTemporal} onAddTask={onModelingTask} /> : null}

        <details className="stoicheion-alphabet-section stoicheion-alphabet-disclosure" data-testid="stoicheion-alphabet-disclosure"
          onToggle={event => {
            const section = event.currentTarget;
            if (section.open) requestAnimationFrame(() => {
              if (section.open && section.isConnected) section.scrollIntoView({ block: "start",
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
            });
          }}>
          <summary className="year-details-button" data-testid="stoicheion-alphabet-toggle"><span><ExperimentalIcon name="book-open"/></span><span><strong data-no-translate>{alphabetCopy[language].title}</strong></span><ExperimentalIcon name="chevron-down"/></summary>
          <div className="stoicheion-alphabet-content">
          <header>
            <div>
              <span className="eyebrow">Основной греческий ряд · 24</span>
              <h2 id="stoicheion-alphabet-title">Выберите букву</h2>
            </div>
            <p>Нажмите на любой знак, чтобы открыть метафизический профиль, прямое и перевёрнутое положения, практику и числовое значение.</p>
          </header>
          <div className="stoicheion-alphabet-grid">
            {letters.map((letter) => (
              <button
                type="button"
                key={letter.id}
                onClick={() => setSelectedReading({ letter, reversed: null, position: null })}
                aria-label={`Открыть карту ${letter.name}, ${letter.symbol}`}
              >
                <StoicheionCardFace letter={letter} variant="alphabet" />
              </button>
            ))}
          </div>
          </div>
        </details>

        <footer className="stoicheion-footer">
          {divinationDisabled ? (
            <span>Гадания отключены настройкой вашей учётной записи</span>
          ) : (
            <>
              <span>Случайность собирается локально</span>
              <span>Дневные попытки закрепляются за вашей учётной записью</span>
            </>
          )}
        </footer>
      </div>

      {timelineHelpOpen && typeof document !== "undefined" ? createPortal(
        <StoicheionTimelineHelp language={language} onClose={() => setTimelineHelpOpen(false)} />, document.body) : null}

      {motion && typeof document !== "undefined" ? createPortal(
        <div
          className="stoicheion-motion-veil"
          data-dialog-header="none"
          ref={motionDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={motion.mode === "daily" ? "Поле выбора карты дня" : motion.mode === "timeline" ? timeCopy.motion : "Поле выбора девяти карт"}
          tabIndex={-1}
          style={{
            "--motion-progress": motion.progress,
            "--motion-x": `${pointer.x}%`,
            "--motion-y": `${pointer.y}%`,
          } as CSSProperties}
        >
          <button
            ref={motionField}
            type="button"
            className="stoicheion-motion-capture"
            aria-label="Собирать случайность движением мыши, пальца или клавишами со стрелками"
            onPointerDown={startTouchMotion}
            onPointerMove={moveThroughField}
            onKeyDown={moveWithKeyboard}
          />
          <button type="button" className="stoicheion-motion-cancel" onClick={cancelMotion} aria-label="Отменить выбор"><ExperimentalIcon name="close"/></button>
          <div className="stoicheion-motion-stars" aria-hidden="true">
            {letters.slice(0, 12).map((letter, index) => (
              <i key={letter.id} style={{ "--motion-index": index } as CSSProperties}>{letter.symbol}</i>
            ))}
          </div>
          <div className="stoicheion-motion-copy">
            <span className="eyebrow">Поле случайности · движение создаёт зерно</span>
            <h2>{motion.mode === "daily" ? "Проведите рукой над знаками" : motion.mode === "timeline" ? `${motion.replaceCurrent?timeCopy.rerollCard:timeCopy.openCard}: ${timeCopy.positions[motion.position??Math.min(2,timelineRevealed)].title}` : "Соберите девять ликов движением"}</h2>
            <p data-no-translate>{motion.mode === "timeline" ? timeCopy.motionHint : timeCopy.motionGeneralHint}</p>
            <div className="stoicheion-motion-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={motion.progress}>
              <strong>{motion.progress}%</strong>
              <small>движение</small>
            </div>
            <b>{motion.progress < 35 ? "Пробуждение поля" : motion.progress < 75 ? "Знаки смешиваются" : "Образ почти проявился"}</b>
          </div>
        </div>,
        document.body,
      ) : null}

      {selectedReading ? (
        <LetterDetails
          letter={letters.find((letter) => letter.id === selectedReading.letter.id) ?? selectedReading.letter}
          reversed={selectedReading.reversed}
          position={selectedReading.position}
          timeline={selectedReading.timeline}
          onClose={() => setSelectedReading(null)}
          onOpenTheokyklosSector={onOpenTheokyklosSector}
          onStartRestoration={restorationAllowed && workspace && onWorkspaceChange ? startRestoration : undefined}
          restorationAction={restorationPrimary}
          onChooseSacredPractice={beginPractice}
          startedPracticeIds={workspace?.habits.filter(habit => !habit.stoicheionRestoration).map(habit => habit.sacredPracticeId).filter((id): id is string => Boolean(id))}
          sacredPracticesEnabled={sacredPracticesEnabled}
        />
      ) : null}
    </section>
    </div>
  );
}
