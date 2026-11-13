/**
 * Small Markdown reader for notes the author writes (e.g. a mind map / workflow
 * clipping). Produces React elements, never HTML — typed HTML stays text.
 *
 * Supports: headings (#, ##, ###), paragraphs, lists (-, *, 1.) with one nesting
 * level, tasks (- [ ] / - [x]), quotes (>), code blocks (```), rules (---) and
 * inline **bold**, *italic*, `code` and [links](https://…).
 */
import type { ReactNode } from "react";

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((t, i) => {
    const k = `${key}-${i}`;
    if (t.startsWith("**") && t.endsWith("**") && t.length > 4) return <strong key={k}>{t.slice(2, -2)}</strong>;
    if (t.startsWith("`") && t.endsWith("`") && t.length > 2) return <code key={k} className="px-1 rounded bg-secondary font-mono text-[0.9em]">{t.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t);
    if (link) {
      // http(s) only — no javascript: and the like
      const href = /^https?:\/\//i.test(link[2]) ? link[2] : undefined;
      return href
        ? <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">{link[1]}</a>
        : <span key={k}>{link[1]}</span>;
    }
    if (t.startsWith("*") && t.endsWith("*") && t.length > 2) return <em key={k}>{t.slice(1, -1)}</em>;
    return t;
  });
}

type Item = { text: string; done?: boolean; children: Item[] };

const LIST = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const z = lines[i];
    const k = `b${i}`;
    if (!z.trim()) { i++; continue; }
    if (z.trimStart().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={k} className="rounded bg-secondary p-2 text-xs font-mono overflow-x-auto whitespace-pre">{code.join("\n")}</pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(z);
    if (h) {
      const size = h[1].length === 1 ? "text-base" : h[1].length === 2 ? "text-sm" : "text-sm text-muted-foreground";
      blocks.push(<p key={k} role="heading" aria-level={h[1].length} className={`font-semibold ${size}`}>{inline(h[2], k)}</p>);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(z)) { blocks.push(<hr key={k} className="border-border" />); i++; continue; }
    if (z.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={k} className="border-l-2 border-border pl-2 italic text-muted-foreground">{inline(quote.join(" "), k)}</blockquote>);
      continue;
    }
    const l = LIST.exec(z);
    if (l) {
      const ordered = /\d/.test(l[2]);
      const items: Item[] = [];
      const base = l[1].length;
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (!m) {
          // continuation line of an item
          if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) { items[items.length - 1].text += " " + lines[i].trim(); i++; continue; }
          break;
        }
        // switching between numbered and bulleted on the same level starts a new list
        if (m[1].length <= base && /\d/.test(m[2]) !== ordered) break;
        const task = /^\[([ xX])\]\s+(.*)$/.exec(m[3]);
        const p: Item = task ? { text: task[2], done: task[1] !== " ", children: [] } : { text: m[3], children: [] };
        if (m[1].length > base && items.length) items[items.length - 1].children.push(p);
        else items.push(p);
        i++;
      }
      blocks.push(<List key={k} items={items} ordered={ordered} k={k} />);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && !/^(#{1,6}\s|```|>)/.test(lines[i].trimStart())) para.push(lines[i++].trim());
    blocks.push(<p key={k}>{inline(para.join(" "), k)}</p>);
  }
  return <div className={`flex flex-col gap-1.5 ${className}`}>{blocks}</div>;
}

function List({ items, ordered, k }: { items: Item[]; ordered: boolean; k: string }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`pl-5 flex flex-col gap-0.5 ${ordered ? "list-decimal" : "list-disc"}`}>
      {items.map((p, j) => (
        <li key={j} className={p.done !== undefined ? "list-none -ml-5" : ""}>
          {p.done !== undefined && <span aria-hidden className="mr-1">{p.done ? "☑" : "☐"}</span>}
          {inline(p.text, `${k}-${j}`)}
          {p.children.length > 0 && <List items={p.children} ordered={false} k={`${k}-${j}`} />}
        </li>
      ))}
    </Tag>
  );
}
