"use client";

import { habitDisplayText } from "./habit-display-text";
import { HabitGoalAnalysisPanel } from "./HabitGoalAnalysisPanel";
import { buildAnalyzedHabitPersonalRecord, buildHabitGoalComparison } from "./habit-insight-analysis";
import type { HabitDayDecisionCommand } from "./habit-day-decision";
import type { TimeFormat } from "./time-format";
import type { CalendarContext } from "./calendar-context";

import { useId, useMemo, useState, type CSSProperties } from "react";
import {
  calendarMonthKey,
  calendarYearRange,
  calendarYearLabel,
  formatCalendarDateValue,
  formatCalendarMonthValue,
  type CalendarMode,
} from "./calendar-data";
import { formatTranslatedText, translateText, type Language } from "./i18n";
import "./habit-report.css";
import type { HabitWorkspace } from "./habits";
import {
  buildHabitYearMosaic,
  buildWeeklyHabitSummary,
  type HabitWeeklySummary,
} from "./habit-insights";

type HabitInsightsPanelProps = {
  workspace: HabitWorkspace;
  date: string;
  language: Language;
  calendarMode: CalendarMode;
  timeFormat?: TimeFormat;
  scope?: string;
  onOpenHistory?: (date: string, habitId?: string) => void;
  onDayDecision?: (command: HabitDayDecisionCommand, scope: string) => Promise<void>;
  reportContext?: CalendarContext;
};

function rhythmLabel(score: number) {
  if (score >= 80) return "Устойчивый ритм";
  if (score >= 60) return "Ритм укрепляется";
  if (score >= 35) return "Ритм возвращается";
  return "Начало ритма";
}

function comparisonCopy(summary: Pick<HabitWeeklySummary, "changePercent" | "absoluteChange">, language: Language) {
  const t = (text: string) => translateText(text, language);
  if (summary.changePercent === null) return `${summary.absoluteChange > 0 ? "+" : ""}${new Intl.NumberFormat(language).format(summary.absoluteChange)}`;
  if (!summary.absoluteChange) return t("Без изменений");
  return `${summary.changePercent > 0 ? "+" : ""}${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(summary.changePercent)}%`;
}

export function HabitInsightsPanel({ workspace, date, language, calendarMode, reportContext, timeFormat, scope, onOpenHistory, onDayDecision }: HabitInsightsPanelProps) {
  const number = new Intl.NumberFormat(language);
  const [mosaicOpen, setMosaicOpen] = useState(false);
  const mosaicBodyId = useId();
  const weekly = useMemo(() => buildWeeklyHabitSummary(workspace, date, calendarMode, reportContext), [calendarMode, date, reportContext, workspace]);
  const weeklyGoals = useMemo(() => buildHabitGoalComparison(workspace, date, calendarMode, reportContext), [calendarMode, date, reportContext, workspace]);
  const mosaicRange = useMemo(() => calendarYearRange(date, calendarMode, reportContext), [calendarMode, date, reportContext]);
  const mosaic = useMemo(() => buildHabitYearMosaic(workspace.dailyGoalRecords, date, mosaicRange), [date, mosaicRange, workspace.dailyGoalRecords]);
  const records = useMemo(() => [...workspace.habits]
    .sort((left, right) => right.priority - left.priority || left.title.localeCompare(right.title))
    .map((habit) => {
      const record = buildAnalyzedHabitPersonalRecord(workspace, habit, date, calendarMode, (value) => ({
        key: calendarMonthKey(value, calendarMode, reportContext),
        label: formatCalendarMonthValue(value, calendarMode, reportContext),
      }));
      return { habit, record };
    }), [calendarMode, date, reportContext, workspace]);
  const bestHabit = workspace.habits.find(habit => habit.id === weekly.bestHabitId);
  const rhythm = workspace.userProgress.rhythmScore;
  const perfectDays = mosaic.filter((cell) => cell.status === "perfect").length;
  const qualifiedDays = mosaic.filter((cell) => cell.status === "qualified" || cell.status === "perfect").length;
  const yearLabel = calendarYearLabel(date, calendarMode, reportContext);
  const mosaicWeeks = Math.max(1, ...mosaic.map((cell) => cell.week));
  const localized = (value: string) => translateText(value, language);
  const copy = (value: string, values: Record<string, string | number>) => formatTranslatedText(value, language, values);
  const mosaicSummary = copy("{year} · дней с целью: {qualified} · идеальных: {perfect}", { year: yearLabel, qualified: number.format(qualifiedDays), perfect: number.format(perfectDays) });

  return (
    <div className="habit-phase-k-insights">
      <HabitGoalAnalysisPanel key={scope} workspace={workspace} date={date} language={language} calendarMode={calendarMode} reportContext={reportContext}
        timeFormat={timeFormat} scope={scope} onOpenHistory={onOpenHistory} onDayDecision={onDayDecision} />
      <section className="habit-weekly-summary" aria-labelledby="habit-weekly-summary-title">
        <header>
          <div><h3 id="habit-weekly-summary-title">{localized("Итоги периода")}</h3><p>{formatCalendarDateValue(weekly.startDate, calendarMode, false, reportContext)} — {formatCalendarDateValue(weekly.endDate, calendarMode, false, reportContext)}</p></div>
          <div className={`habit-weekly-change ${weeklyGoals.absoluteChange > 0 ? "positive" : weeklyGoals.absoluteChange < 0 ? "negative" : "neutral"}`} aria-label={localized("Успешные закрытые цели")}>
            <strong>{weeklyGoals.current.planned ? comparisonCopy(weeklyGoals, language) : "—"}</strong>
            <small>{localized(!weeklyGoals.current.planned ? "Нет закрытых целей для сравнения" : weeklyGoals.changePercent === null ? "Нет базы для процентного сравнения" : "Сравнение одинаковых промежутков")}</small>
          </div>
        </header>
        <p className="habit-comparison-explanation">{localized("Успешные закрытые цели")}: {number.format(weeklyGoals.current.completed)}/{number.format(weeklyGoals.current.planned)}.
          {weeklyGoals.previousEnd ? <> {localized("Предыдущий промежуток")}: {formatCalendarDateValue(weeklyGoals.previousStart, calendarMode, false, reportContext)} — {formatCalendarDateValue(weeklyGoals.previousEnd, calendarMode, false, reportContext)} · {number.format(weeklyGoals.previous.completed)}/{number.format(weeklyGoals.previous.planned)}.</> : null}
          {" "}{localized("Сравниваются только прошедшие дни обоих периодов.")}
          {weeklyGoals.open ? <> {localized("Открытые цели")}: {number.format(weeklyGoals.open)}.</> : null}
          {weeklyGoals.current.unknown || weeklyGoals.previous.unknown ? <> {localized("Даты с неизвестной историей пауз исключены из сравнения.")}</> : null}</p>
        <div className="habit-weekly-grid">
          <article><span>{localized("Дни с выполненной активностью")}</span><strong>{number.format(weekly.completed)}</strong><small>{localized("Цели периода учитываются отдельно.")}</small></article>
          <article><span>{localized("Дневных целей")}</span><strong>{number.format(weekly.dailyGoals)}</strong><small>{localized("за прошедшие дни")}</small></article>
          <article><span>{localized("Идеальных дней")}</span><strong>{number.format(weekly.perfectDays)}</strong><small>Perfect Day</small></article>
          <article><span>{localized("Опыт")}</span><strong>+{number.format(weekly.xp)} XP</strong><small>{localized("за реальные выполнения")}</small></article>
          <article><span>{localized("Лавров начислено")}</span><strong>♕ {number.format(weekly.laurels)}</strong><small>{localized("положительные записи журнала")}</small></article>
          <article><span>{localized("Лучшая привычка")}</span><strong data-no-translate>{bestHabit ? habitDisplayText(bestHabit, language).title : weekly.bestHabitTitle ?? "—"}</strong><small>{weekly.bestHabitCompleted ? copy("Выполнено: {count}", { count: number.format(weekly.bestHabitCompleted) }) : localized("Лидера пока нет")}</small></article>
        </div>
      </section>

      <section className="habit-rhythm-index" aria-labelledby="habit-rhythm-index-title" style={{ "--rhythm-score": rhythm } as CSSProperties}>
        <div className="habit-rhythm-gauge" role="img" aria-label={copy("Индекс Ритма {value} из 100", { value: number.format(rhythm) })}><span><strong>{number.format(rhythm)}</strong><small>/100</small></span></div>
        <div><span className="eyebrow">{localized("Последние 28 дней")}</span><h3 id="habit-rhythm-index-title">{localized("Индекс Ритма")}</h3><strong>{localized(rhythmLabel(rhythm))}</strong><p>{localized("Клиентский показатель последовательности. Недавние дни имеют больший вес, поэтому возвращение к практике становится заметно быстро.")}</p></div>
      </section>

      <section className={`habit-year-mosaic${mosaicOpen ? " open" : ""}`}>
        <button
          type="button"
          className="habit-year-mosaic-toggle"
          aria-expanded={mosaicOpen}
          aria-controls={mosaicBodyId}
          onClick={() => setMosaicOpen((current) => !current)}
        >
          <span><small>{localized("Перспектива года")}</small><strong>{localized("Мозаика года")}</strong></span>
          <span className="habit-year-mosaic-meta">{mosaicSummary}</span>
          <svg className={`disclosure-chevron${mosaicOpen ? " open" : ""}`} viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5.5 7.5 4.5 4.5 4.5-4.5" />
          </svg>
        </button>
        {mosaicOpen ? <div className="habit-year-mosaic-body" id={mosaicBodyId}>
          <div className="habit-year-mosaic-grid" role="img" aria-label={`${copy("Мозаика активности привычек за {year} год", { year: yearLabel })}. ${mosaicSummary}`} style={{ "--mosaic-weeks": mosaicWeeks } as CSSProperties}>
            {mosaic.map((cell) => <i className={cell.status} style={{ "--mosaic-week": cell.week, "--mosaic-weekday": cell.weekday } as CSSProperties} title={`${formatCalendarDateValue(cell.date, calendarMode, true, reportContext)}: ${number.format(cell.completed)}/${number.format(cell.scheduled)}`} key={cell.date} />)}
          </div>
          <footer><span>{localized("Нет активности")}</span><i className="none" /><i className="partial" /><i className="qualified" /><i className="perfect" /><span>{localized("Идеальный день")}</span></footer>
        </div> : null}
      </section>

      {records.length ? <section className="habit-personal-records" aria-labelledby="habit-personal-records-title">
        <header><div><span className="eyebrow">{localized("Соревнование с собой")}</span><h3 id="habit-personal-records-title">{localized("Личные рекорды и мастерство")}</h3><p>{localized("Прогресс каждой привычки существует отдельно от общего героического ранга.")}</p></div></header>
        <div className="habit-personal-record-grid">{records.map(({ habit, record }) => (
          <article style={{ "--habit-color": habit.color, "--mastery-progress": record.milestoneProgress } as CSSProperties} key={habit.id}>
            <header><span aria-hidden="true">{habit.emoji}</span><div><h4 data-no-translate>{habitDisplayText(habit, language).title}</h4><small>{localized("Начало")} {formatCalendarDateValue(record.startedAt, calendarMode, true, reportContext)}</small></div><div className="habit-mastery-ring"><strong>{number.format(record.totalCompletions)}</strong><small>{localized("всего")}</small></div></header>
            <div className="habit-record-metrics">
              <div><span>{localized("Текущая серия")}</span><strong>{number.format(record.currentStreak)}{record.periodUnit ? ` ${localized("периодов")}` : ""}</strong></div>
              <div><span>{localized("Лучшая серия")}</span><strong>{number.format(record.longestStreak)}{record.periodUnit ? ` ${localized("периодов")}` : ""}</strong></div>
              <div><span>{localized("Успешные закрытые цели")}</span><strong>{record.completionRate === null ? "—" : `${new Intl.NumberFormat(language).format(record.completionRate)}%`}</strong>
                <small>{number.format(record.scheduledCompletedCount)}/{number.format(record.scheduledCount)}</small>
                {record.unknownDays ? <small>{localized("Доступность неизвестна")}: {number.format(record.unknownDays)}</small> : null}
                {record.unscheduledCompletions ? <small>{localized("Выполнения вне процента")}: {number.format(record.unscheduledCompletions)}</small> : null}
              </div>
              <div><span>{localized("Лучший месяц")}</span><strong>{record.bestMonth ?? "—"}</strong><small>{record.bestMonthCompletions ? number.format(record.bestMonthCompletions) : ""}</small></div>
            </div>
            <footer><div><span>{record.reachedMilestone ? copy("Рубеж {count}", { count: number.format(record.reachedMilestone) }) : localized("Первый рубеж")}</span><div><i /></div></div><strong>{record.nextMilestone ? copy("{count} до {target}", { count: number.format(record.nextMilestone - record.totalCompletions), target: number.format(record.nextMilestone) }) : localized("Высший рубеж достигнут")}</strong></footer>
          </article>
        ))}</div>
      </section> : null}
    </div>
  );
}
