// Compatibility excerpt from app/habit-timer.ts at d4b517b (2.8.12), before history writer 6.
// Keep the shipped old reader here: this regression must not silently use the new decoder.
const fail = () => { throw new RangeError("INVALID_HABIT_TIMER"); };
export function habitTimerEpoch(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || !/^\d{12}-[a-zA-Z0-9-]{1,64}$/.test(value)) return fail();
  return value;
}
