import { SOLAR_OVERVIEW, clampSolarCamera, type SolarCamera } from "./solar-calendar-camera.ts";

type NativeMotion = { current: () => SolarCamera; cancel: () => void };
type MotionOptions = {
  now: () => number;
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (id: number) => void;
  delay: (callback: () => void, milliseconds: number) => number;
  clearDelay: (id: number) => void;
  reducedMotion: () => boolean;
  render: (camera: SolarCamera) => void;
  onMoving: (moving: boolean) => void;
  onSettled: (camera: SolarCamera) => void;
  animate?: (from: SolarCamera, to: SolarCamera, finished: () => void) => NativeMotion;
};

/** One compositor update per frame; no animation loop or promoted layer at rest. */
export function createSolarCameraMotion(options: MotionOptions) {
  let current = { ...SOLAR_OVERVIEW }, frame = 0, timer = 0, moving = false, disposed = false;
  let tween: { from: SolarCamera; to: SolarCamera; started: number } | null = null;
  let native: NativeMotion | null = null, generation = 0;
  const markMoving = (next: boolean) => { if (moving !== next) { moving = next; options.onMoving(next); } };
  const cancelPending = () => {
    if (frame) options.cancelFrame(frame);
    if (timer) options.clearDelay(timer);
    frame = 0; timer = 0;
  };
  const settle = () => { markMoving(false); options.onSettled(current); };
  const stopNative = () => {
    ++generation;
    if (!native) return;
    current = native.current(); options.render(current); native.cancel(); native = null;
  };
  const paint = (now: number) => {
    frame = 0;
    if (disposed) return;
    if (tween) {
      const progress = Math.min(1, (now - tween.started) / 420), ease = 1 - Math.pow(1 - progress, 4);
      current = { x: tween.from.x + (tween.to.x - tween.from.x) * ease, y: tween.from.y + (tween.to.y - tween.from.y) * ease,
        size: tween.from.size + (tween.to.size - tween.from.size) * ease };
      if (progress === 1) tween = null;
      options.render(current);
      if (tween) frame = options.requestFrame(paint); else settle();
    } else options.render(current);
  };
  return {
    get current() { return native ? native.current() : { ...current }; },
    move(target: SolarCamera, animate = true) {
      if (disposed) return;
      const next = clampSolarCamera(target);
      stopNative();
      if (timer) options.clearDelay(timer);
      timer = 0;
      if (animate || tween) { if (frame) options.cancelFrame(frame); frame = 0; tween = null; }
      if (animate && options.reducedMotion()) {
        current = next; options.render(current); settle(); return;
      }
      markMoving(true);
      if (animate && options.animate) {
        const ticket = generation;
        native = options.animate({ ...current }, next, () => {
          if (disposed || ticket !== generation) return;
          const completed = native; native = null; current = next;
          options.render(current); completed?.cancel(); settle();
        });
        return;
      }
      if (animate) tween = { from: { ...current }, to: next, started: options.now() };
      else {
        // Store the latest gesture position immediately; burst events share one frame.
        current = next;
        timer = options.delay(() => { timer = 0; if (frame) { options.cancelFrame(frame); frame = 0; options.render(current); } settle(); }, 140);
      }
      if (!frame) frame = options.requestFrame(paint);
    },
    interrupt() { cancelPending(); stopNative(); tween = null; if (!disposed) settle(); },
    refresh() { if (!disposed) { const wasAnimating = Boolean(native); stopNative(); options.render(current); if (wasAnimating) settle(); } },
    dispose() { disposed = true; cancelPending(); stopNative(); tween = null; markMoving(false); },
  };
}
