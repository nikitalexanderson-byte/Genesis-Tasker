export type WeekStart = "sunday" | "monday";

export function gregorianWeekdayOffset(date: Date, weekStart: WeekStart) {
  return weekStart === "monday" ? (date.getDay() + 6) % 7 : date.getDay();
}

export function gregorianMonthNumber(date: Date, yearStart: "january" | "march" = "january") {
  return (date.getMonth() - (yearStart === "march" ? 2 : 0) + 12) % 12 + 1;
}
