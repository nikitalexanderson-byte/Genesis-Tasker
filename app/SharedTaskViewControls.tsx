"use client";
import type { ReactNode } from "react";

/** Project actions precede the task query in the shared toolbar. */
export function SharedTaskViewControls({sorting, search}: { sorting: ReactNode; search: ReactNode }) {
  return <div className="shared-task-view-controls">{sorting}{search}</div>;
}
