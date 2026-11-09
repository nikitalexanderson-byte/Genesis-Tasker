import type { DailyAdvice } from "./daily-advice";

/** Display only: keep meaningful line breaks without blank rows from imported advice. */
export function compactAdviceBody(body: string): string {
  return body.replace(/\r\n?/g, "\n").split("\n").filter(line => line.trim()).join("\n").trim();
}

/** User edits are their own text; only an unchanged saved advice gets advice formatting. */
export function originalAdvicePreview(note: { body: string; advice?: DailyAdvice }): DailyAdvice | null {
  return note.advice?.body === note.body ? note.advice : null;
}
