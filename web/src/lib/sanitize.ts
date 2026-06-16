import DOMPurify from "dompurify";

/**
 * Sanitize stored/imported scene HTML before injecting it via
 * `dangerouslySetInnerHTML`.
 *
 * Scene content is raw HTML that can originate from imported documents or a
 * synced/shared data directory, so it must be treated as untrusted to prevent
 * stored XSS executing in the (privileged, same-origin-to-the-API) 127.0.0.1
 * renderer origin.
 *
 * The content is only ever populated by client-side queries, so during SSR
 * (no `window`/DOM) there is nothing to render — return an empty string rather
 * than attempting to sanitize without a DOM.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (typeof window === "undefined") return "";
  return DOMPurify.sanitize(html ?? "", { USE_PROFILES: { html: true } });
}
