import type { Mindmap, MapView } from "./mindmaps-model";

export type MindmapEditSnapshot = { document: Mindmap; positions: MapView["positions"]; selected: string };

/** Session history changes map content and layout; referenced tasks stay outside it. */
export class MindmapEditHistory {
  private past: MindmapEditSnapshot[] = [];
  private future: MindmapEditSnapshot[] = [];
  private group = "";
  private recordedAt = 0;
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  clear() { this.past = []; this.future = []; this.group = ""; }
  record(before: MindmapEditSnapshot, after: MindmapEditSnapshot, group = "", timestamp = Date.now()) {
    if (before.document.id !== after.document.id) { this.clear(); return; }
    if (JSON.stringify([before.document,before.positions]) === JSON.stringify([after.document,after.positions])) return;
    if (!group || group !== this.group || timestamp - this.recordedAt > 900 || this.future.length)
      this.past = [...this.past.slice(-49), before];
    this.future = []; this.group = group; this.recordedAt = timestamp;
  }
  take(direction: "undo" | "redo", current: MindmapEditSnapshot): MindmapEditSnapshot | null {
    const source = direction === "undo" ? this.past : this.future;
    const target = source.at(-1);
    if (!target || target.document.id !== current.document.id) return null;
    if (direction === "undo") { this.past = source.slice(0,-1); this.future = [...this.future,current]; }
    else { this.future = source.slice(0,-1); this.past = [...this.past,current]; }
    this.group = "";
    return target;
  }
}
