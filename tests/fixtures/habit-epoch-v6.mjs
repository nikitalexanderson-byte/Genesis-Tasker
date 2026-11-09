// Protocol 6 reader, copied from cf22dc6. Unknown envelope markers must block writes.
export function habitTimerEpoch(value) {
  if (typeof value === "string" && value.startsWith("history6:")) value = value.slice(9);
  if (value == null || value === "") return "";
  if (typeof value !== "string" || !/^\d{12}-[a-zA-Z0-9-]{1,64}$/.test(value)) throw new RangeError("INVALID_HABIT_TIMER");
  return value;
}
