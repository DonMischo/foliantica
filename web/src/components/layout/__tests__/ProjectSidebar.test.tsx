import { vi } from "vitest";

// Node 22 has a broken experimental localStorage — stub it before any component
// (ProjectSidebar reads localStorage in its useState initializer).
const _store: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => _store[k] ?? null,
  setItem: (k: string, v: string) => { _store[k] = v; },
  removeItem: (k: string) => { delete _store[k]; },
  clear: () => { Object.keys(_store).forEach((k) => delete _store[k]); },
});

/**
 * Tests for ProjectSidebar navigation items.
 *
 * The sidebar has many internal dependencies (DnD Kit, Next.js router, dozens
 * of query hooks). This file mocks the external dependencies and verifies the
 * observable navigation output — specifically the bottom nav links (Codex,
 * Relations) and that the Story section header renders.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";

// ── Next.js mocks ──────────────────────────────────────────────────────────────
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) =>
    createElement("a", { href, ...rest }, children),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "42", sceneId: undefined }),
  useRouter: () => ({ push: vi.fn() }),
}));

// ── DnD Kit mocks ──────────────────────────────────────────────────────────────
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: any) => createElement("div", null, children),
  closestCenter: vi.fn(),
  KeyboardSensor: class {},
  PointerSensor: class {},
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => ({})),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: any) => createElement("div", null, children),
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
  arrayMove: vi.fn((arr: any[]) => arr),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => "" } },
}));

// ── Query hooks mock ───────────────────────────────────────────────────────────
vi.mock("@/store/queries", () => ({
  useActs: () => ({ data: [] }),
  useChapters: () => ({ data: [] }),
  useCreateAct: () => ({ mutate: vi.fn() }),
  useCreateChapter: () => ({ mutate: vi.fn() }),
  useCreateScene: () => ({ mutateAsync: vi.fn() }),
  useDeleteAct: () => ({ mutate: vi.fn() }),
  useDeleteChapter: () => ({ mutate: vi.fn() }),
  useDeleteScene: () => ({ mutate: vi.fn() }),
  useReorderActs: () => ({ mutate: vi.fn() }),
  useReorderChapters: () => ({ mutate: vi.fn() }),
  useReorderScenes: () => ({ mutate: vi.fn() }),
  useReorderScenesGlobal: () => ({ mutate: vi.fn() }),
  useAllScenesForChapters: () => ({}),
  useUpdateAct: () => ({ mutate: vi.fn() }),
  useUpdateChapter: () => ({ mutate: vi.fn() }),
  useProject: () => ({ data: { id: 42, title: "My Novel" } }),
  useUpdateProject: () => ({ mutate: vi.fn() }),
  useTimeConfig: () => ({ data: null }),
  useUpdateTimeConfig: () => ({ mutate: vi.fn() }),
  useCodexEntries: () => ({ data: [] }),
  useSyncStatus: () => ({ data: null }),
}));

// ── Language context mock ─────────────────────────────────────────────────────
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

// ── API mock ───────────────────────────────────────────────────────────────────
vi.mock("@/lib/api", () => ({
  scenesApi: { update: vi.fn() },
  syncApi: { status: vi.fn() },
}));

// ── Child component mocks ──────────────────────────────────────────────────────
vi.mock("@/components/layout/ImportButton", () => ({
  ImportButton: () => null,
}));
vi.mock("@/components/time/TimeConfigDialog", () => ({
  TimeConfigDialog: () => null,
}));
vi.mock("@/components/export/ExportDialog", () => ({
  ExportDialog: () => null,
}));
vi.mock("@/components/project/BookMetaDialog", () => ({
  BookMetaDialog: () => null,
}));
vi.mock("@/components/layout/ScenePlanPopover", () => ({
  ScenePlanPopover: () => null,
}));
vi.mock("@/components/corkboard/ColorPicker", () => ({
  MAIN_COLOR: "#6366f1",
  SUBPLOT_PALETTE: ["#ef4444", "#3b82f6"],
}));
vi.mock("@/store/colColors", () => {
  const state = {
    mode: "subplot",
    setMode: vi.fn(),
    ensureLoaded: vi.fn(),
    byProject: {} as Record<number, any>,
  };
  return {
    useColColorsStore: (selector?: (s: typeof state) => any) =>
      typeof selector === "function" ? selector(state) : state,
  };
});

import { ProjectSidebar } from "../ProjectSidebar";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe("ProjectSidebar — nav items", () => {
  it("renders without crashing", () => {
    expect(() =>
      render(createElement(ProjectSidebar, { projectId: 42 }), { wrapper })
    ).not.toThrow();
  });

  it("renders the Story section header", () => {
    render(createElement(ProjectSidebar, { projectId: 42 }), { wrapper });
    // useLanguage returns t(key) = key, so "nav_story" is the rendered text
    expect(screen.getByText("nav_story")).toBeInTheDocument();
  });

  it("renders a Codex navigation link with the correct href", () => {
    render(createElement(ProjectSidebar, { projectId: 42 }), { wrapper });
    const codexLink = screen.getByText("nav_codex").closest("a");
    expect(codexLink).toHaveAttribute("href", "/projects/42/codex");
  });

  it("renders a Relations navigation link with the correct href", () => {
    render(createElement(ProjectSidebar, { projectId: 42 }), { wrapper });
    const relationsLink = screen.getByText("nav_relations").closest("a");
    expect(relationsLink).toHaveAttribute("href", "/projects/42/relations");
  });
});
