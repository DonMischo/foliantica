import "@testing-library/jest-dom";

// In Vitest 4 + Node 22, bare `localStorage` resolves to Node's experimental
// implementation (which throws without --experimental-localstorage-file) rather than
// jsdom's. Force-replace it with the jsdom version unconditionally when jsdom is active.
if (typeof window !== "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: window.localStorage,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    value: window.sessionStorage,
    writable: true,
    configurable: true,
  });
}
