import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "../sanitize";

describe("sanitizeHtml", () => {
  it("strips <script> tags but keeps surrounding markup", () => {
    const out = sanitizeHtml("<p>hi</p><script>alert(1)</script>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("<p>hi</p>");
  });

  it("removes inline event-handler attributes (onerror, onload, …)", () => {
    const out = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert");
  });

  it("strips javascript: URLs from links", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain("javascript:");
  });

  it("preserves benign formatting markup", () => {
    const out = sanitizeHtml("<p><strong>bold</strong> and <em>italic</em></p>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
  });

  it("preserves data-* attributes used by scene/codex nodes", () => {
    const out = sanitizeHtml('<div data-type="scene-image" data-src="uploads/a.png"></div>');
    expect(out).toContain('data-type="scene-image"');
    expect(out).toContain('data-src="uploads/a.png"');
  });

  it("returns an empty string for null/undefined input", () => {
    expect(sanitizeHtml(null)).toBe("");
    expect(sanitizeHtml(undefined)).toBe("");
  });
});
