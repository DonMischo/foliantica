import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { codeFromReply, diagramPrompt, readErrors } from "../d2";
import { Markdown } from "@/components/Markdown";

describe("d2 helpers", () => {
  it("takes only the code out of a fenced AI reply", () => {
    expect(codeFromReply("Sure:\n```d2\na -> b\n```\nEnjoy")).toBe("a -> b\n");
    expect(codeFromReply("a -> b")).toBe("a -> b");
  });

  it("reads D2's JSON error list into line messages", () => {
    const e = new Error(JSON.stringify([{ errmsg: "index:3:5: unexpected token" }]));
    expect(readErrors(e)).toEqual(["Line 3: unexpected token"]);
    expect(readErrors(new Error("boom"))).toEqual(["boom"]);
  });

  it("puts notes, style rules and the current diagram into the prompt", () => {
    const p = diagramPrompt({ style: "workflow", title: "Revision", notes: "1. Read aloud", current: "a -> b" });
    expect(p).toContain("a flowchart");
    expect(p).toContain("Topic: Revision");
    expect(p).toContain("1. Read aloud");
    expect(p).toContain("decisions as diamond");
    expect(p).toContain("```d2\na -> b\n```");
    expect(diagramPrompt({ style: "mindmap", title: "", notes: "" })).not.toContain("Build on this diagram");
  });
});

describe("Markdown", () => {
  it("renders lists, tasks and inline formatting as elements", () => {
    const { container } = render(<Markdown text={"## Steps\n1. **Draft**\n2. Cut\n- [x] done"} />);
    expect(container.querySelector('[role="heading"]')?.textContent).toBe("Steps");
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("Draft");
    expect(container.textContent).toContain("☑");
  });

  it("keeps typed HTML as text and drops javascript: links", () => {
    const { container } = render(<Markdown text={'<img src=x onerror=alert(1)> [x](javascript:alert(1))'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });
});
