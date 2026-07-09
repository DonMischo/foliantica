"use client";

import { sphereGradientId } from "@/lib/canvasStyle";

/**
 * Shared SVG <defs> for the canvas views: one glossy-sphere radial gradient
 * per node color, plus a reusable arrowhead marker.
 *
 * Mount once inside the page's root <svg>:
 *   <defs><CanvasGradientDefs colors={nodeColors} /></defs>
 */
export function CanvasGradientDefs({
  colors,
  arrowColor = "#6b7280",
}: {
  colors: string[];
  arrowColor?: string;
}) {
  const unique = [...new Set(colors)];
  return (
    <>
      <marker
        id="canvas-arrow"
        markerWidth="6"
        markerHeight="6"
        refX="5"
        refY="3"
        orient="auto"
      >
        <path d="M0,0 L0,6 L6,3 z" fill={arrowColor} fillOpacity={0.6} />
      </marker>
      {unique.map((color) => (
        <radialGradient
          key={color}
          id={sphereGradientId(color)}
          cx="35%"
          cy="28%"
          r="70%"
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.55} />
          <stop offset="50%" stopColor={color} stopOpacity={1} />
          <stop offset="100%" stopColor={color} stopOpacity={1} />
        </radialGradient>
      ))}
    </>
  );
}
