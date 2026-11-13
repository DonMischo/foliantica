/**
 * D2 diagrams for mind map / workflow clippings.
 *
 * `@d2lang/d2` ships WASM + worker in one file (≈ 11 MB). It is imported only
 * when the first diagram is drawn and then reused for every diagram on the page.
 */
import type { D2 } from "@d2lang/d2";

let instance: Promise<D2> | null = null;

function d2(): Promise<D2> {
  instance ??= import("@d2lang/d2").then(m => new m.D2());
  return instance;
}

/** D2 reports errors as a JSON list `[{errmsg: "index:3:5: …"}]`. */
export function readErrors(e: unknown): string[] {
  const text = e instanceof Error ? e.message : String(e);
  try {
    const list = JSON.parse(text) as { errmsg?: string }[];
    if (Array.isArray(list)) {
      return list.map(f => {
        const m = /^[^:]*:(\d+):\d+:\s*(.*)$/.exec(f.errmsg ?? "");
        return m ? `Line ${m[1]}: ${m[2]}` : f.errmsg ?? text;
      });
    }
  } catch { /* not JSON */ }
  return [text];
}

/** Strips scripts, event attributes and javascript: links from the SVG. */
function sanitizeSvg(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  doc.querySelectorAll("script, iframe, object, embed, foreignObject").forEach(n => n.remove());
  doc.querySelectorAll("*").forEach(el => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name)) el.removeAttribute(a.name);
      else if (/href$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  });
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export async function renderD2(code: string): Promise<string> {
  const d = await d2();
  const r = await d.compile(code);
  return sanitizeSvg(await d.render(r.diagram, { ...r.renderOptions, noXMLTag: true }));
}

/** AI replies often wrap the code in a Markdown fence — keep only the code. */
export function codeFromReply(text: string): string {
  const m = /```[^\n]*\n([\s\S]*?)```/.exec(text);
  return m ? m[1] : text;
}

export const EXAMPLE_D2 = `direction: right
idea: Story idea { shape: oval }
idea -> plot
idea -> characters
idea -> world
plot: Plot
characters: Characters
world: World
`;

export type DiagramStyle = "mindmap" | "workflow" | "auto";

export const DIAGRAM_STYLES: Record<DiagramStyle, { label: string; what: string; rules: string[] }> = {
  mindmap: {
    label: "Mind map",
    what: "a mind map",
    rules: [
      "Mind map: direction: right, one central node as oval, at most three levels, keywords instead of sentences",
      "Mind map: every main branch gets its own light fill colour, its sub-branches the same one",
    ],
  },
  workflow: {
    label: "Workflow",
    what: "a flowchart",
    rules: [
      "Flowchart: direction: down, start and end as oval, decisions as diamond with yes/no on the arrows",
      "Flowchart: each step a short phrase starting with a verb",
    ],
  },
  auto: {
    label: "Let AI choose",
    what: "a fitting diagram (mind map, flowchart, cycle or overview)",
    rules: ["Pick the diagram type that explains the notes best and set direction accordingly"],
  },
};

const RULES = [
  "Every node gets a short id without spaces and a label, e.g. hero: The hero",
  "Connections: a -> b or a -> b: label (also <-, <->, --)",
  "Shapes only via shape: rectangle, oval, diamond, parallelogram, circle, hexagon, cylinder, document, cloud or person",
  "Colours only via style.fill, style.stroke or style.font-color as a quoted hex value, e.g. style.fill: \"#bbf7d0\"",
  "No JSON, classes, layers, Markdown, icons or images",
  "Put labels containing #, ; or curly braces in \"double quotes\"",
  "Write the labels in the same language as the notes, short and clear",
];

/** Prompt that turns the notes into D2 — sent to the built-in AI or copied into an outside chat. */
export function diagramPrompt({ style, title, notes, current }: {
  style: DiagramStyle; title: string; notes: string; current?: string;
}): string {
  const s = DIAGRAM_STYLES[style];
  const lines = [
    `Create ${s.what} in the D2 diagram language (https://d2lang.com).`,
    "",
    `Topic: ${title.trim() || "(untitled)"}`,
  ];
  if (notes.trim()) lines.push("", "Base it on these notes — show every point, invent nothing:", '"""', notes.trim(), '"""');
  lines.push(
    "",
    "Reply only with the D2 code in a code block (```d2 … ```), no explanation before or after.",
    "",
    "Rules:",
    ...[...RULES, ...s.rules].map(r => `- ${r}`),
  );
  if (current?.trim()) {
    lines.push("", "Build on this diagram, keep its ids and return the complete new code:", "```d2", current.trim(), "```");
  }
  return lines.join("\n");
}
