/**
 * Shared visual language for the canvas views (Timeline, Relations, Corkboard).
 *
 * All three views render node-and-edge graphics; this module is the single
 * source for their gradients, curves, and elevation so they read as one
 * product. Pure functions only — no React, no DOM.
 */

// ── Gradient ids ──────────────────────────────────────────────────────────────

/** Deterministic SVG gradient id for a node color ("#a1b2c3" → "sphere-a1b2c3"). */
export function sphereGradientId(color: string): string {
  return "sphere-" + color.replace(/[^a-zA-Z0-9]/g, "");
}

// ── Bezier paths ──────────────────────────────────────────────────────────────

/**
 * Cubic bezier between two points, curving perpendicular to the line.
 * curvature 0 = straight line, ~0.25 = gentle arc (default).
 */
export function bezierPath(
  x1: number, y1: number,
  x2: number, y2: number,
  curvature = 0.25,
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  // Perpendicular offset for the control points
  const px = -dy * curvature;
  const py = dx * curvature;
  const c1x = x1 + dx / 3 + px;
  const c1y = y1 + dy / 3 + py;
  const c2x = x1 + (2 * dx) / 3 + px;
  const c2y = y1 + (2 * dy) / 3 + py;
  return `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
}

/**
 * Vertical S-curve connector (Timeline: axis → card). Starts and ends
 * vertically, easing horizontally if the endpoints are offset.
 */
export function verticalConnectorPath(
  x1: number, y1: number,
  x2: number, y2: number,
): string {
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

// ── Elevation (shadow) tokens ─────────────────────────────────────────────────
// Tailwind-compatible class strings so cards share identical depth cues.

export const ELEVATION = {
  /** Resting card */
  rest: "shadow-sm",
  /** Hovered card — lifts slightly */
  hover: "hover:shadow-lg hover:shadow-black/20 hover:-translate-y-px",
  /** Actively dragged / selected card */
  active: "shadow-xl shadow-black/30",
} as const;

/** Combined resting+hover classes with a smooth transition. */
export const CARD_LIFT = `${ELEVATION.rest} ${ELEVATION.hover} transition-all duration-200 ease-out`;

// ── Edge motion ───────────────────────────────────────────────────────────────

/**
 * Shared canvas motion CSS: dash flow along dashed edges (direction cue)
 * and layout-change fade-in. Inject once per page via
 * <style>{CANVAS_MOTION_CSS}</style>.
 */
export const CANVAS_MOTION_CSS = `
@keyframes canvas-dash-flow {
  to { stroke-dashoffset: -20; }
}
.canvas-dash-flow {
  animation: canvas-dash-flow 1.2s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .canvas-dash-flow { animation: none; }
}
@keyframes canvas-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.canvas-fade-in {
  /* Delay ≈ node glide duration so edges appear once nodes settle */
  animation: canvas-fade-in 250ms ease 250ms backwards;
}
@media (prefers-reduced-motion: reduce) {
  .canvas-fade-in { animation: none; }
}
`;
