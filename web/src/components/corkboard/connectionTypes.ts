/** Typed scene-to-scene cable definitions shared by SceneNode handles,
 *  edge styling, and the board legend. */

export interface ConnectionTypeDef {
  id: string;
  label: string;
  color: string;
  /** SVG stroke-dasharray; undefined = solid */
  dash?: string;
}

export const CONNECTION_TYPES: ConnectionTypeDef[] = [
  { id: "foreshadowing", label: "Foreshadowing", color: "#f59e0b", dash: "7 4" },
  { id: "flashback",     label: "Flashback",     color: "#8b5cf6", dash: "2 4" },
  { id: "dependency",    label: "Dependency",    color: "#ef4444" },
  { id: "parallel",      label: "Parallel",      color: "#0ea5e9", dash: "12 5" },
];

const FALLBACK: ConnectionTypeDef = { id: "reference", label: "Reference", color: "#6b7280" };

export function connectionTypeDef(id: string): ConnectionTypeDef {
  return CONNECTION_TYPES.find((t) => t.id === id) ?? FALLBACK;
}
