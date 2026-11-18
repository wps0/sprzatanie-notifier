/**
 * @fileoverview Animations that survive re-renders.
 *
 * The app rebuilds its DOM on every change of the model, so a CSS animation
 * on a fresh element would restart whenever anything else changes (a busy
 * flag, a toast). Instead, an animation is started by name with `trigger()`,
 * and every render that draws the animated element calls `animate()`, which
 * applies the animation with a negative delay: the new element continues
 * exactly where the previous one was, and nothing restarts.
 */

/** Anything with a class list and inline style: HTML and SVG elements. */
export interface Animatable {
  readonly classList: {add(...tokens: string[]): void};
  readonly style: {animationDelay: string};
}

/** Durations of the animation utilities in style.css. */
export const POP_MS = 450;
export const TOAST_IN_MS = 280;
export const GROW_MS = 700;

/** Name of the animation shown when a task is marked done. */
export function doneKey(weekStart: string, taskKey: string): string {
  return `done:${weekStart}|${taskKey}`;
}

const startedAt = new Map<string, number>();

/** Starts (or restarts) the named animation now. */
export function trigger(key: string, now = performance.now()): void {
  startedAt.set(key, now);
}

/**
 * How far the named animation has run, from 0 to 1, or null when it is not
 * running (never started, or already finished).
 */
export function progressOf(
  key: string,
  durationMs: number,
  now = performance.now(),
): number | null {
  const start = startedAt.get(key);
  if (start === undefined) return null;
  const elapsed = now - start;
  if (elapsed >= durationMs) {
    startedAt.delete(key);
    return null;
  }
  return Math.max(0, elapsed) / durationMs;
}

/**
 * Applies `className` (an animation utility) to `element` if the named
 * animation is still running, continuing from its current point.
 */
export function animate(
  element: Animatable,
  key: string,
  className: string,
  durationMs: number,
  now = performance.now(),
): void {
  const progress = progressOf(key, durationMs, now);
  if (progress === null) return;
  element.classList.add(...className.split(' '));
  element.style.animationDelay = `${-Math.round(progress * durationMs)}ms`;
}

/** True when the user asked the system to reduce motion. */
export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
