import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useCollabStore } from "@/store/collabStore";
import { PresenceBar } from "../PresenceBar";

type PresenceRecord = Parameters<typeof useCollabStore.setState>[0] extends { presence?: infer T }
  ? T extends (infer U)[] ? U : never
  : never;

function makeUser(overrides: Partial<PresenceRecord> = {}): PresenceRecord {
  return {
    session_id: "sess-1",
    display_name: "Alice Wonder",
    color: "#ff0000",
    item_type: null,
    item_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  useCollabStore.setState({
    presence: [],
    mySessionId: "me",
    connected: false,
    locks: {},
    _ws: null,
  });
});

// ── Visibility ────────────────────────────────────────────────────────────────

describe("PresenceBar — visibility", () => {
  it("renders nothing when there are no other connected users", () => {
    const { container } = render(<PresenceBar />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the only present user is the local session", () => {
    useCollabStore.setState({
      presence: [makeUser({ session_id: "me" })],
    });
    const { container } = render(<PresenceBar />);
    expect(container.firstChild).toBeNull();
  });

  it("renders when at least one other user is present", () => {
    useCollabStore.setState({
      presence: [makeUser({ session_id: "other" })],
    });
    const { container } = render(<PresenceBar />);
    expect(container.firstChild).not.toBeNull();
  });
});

// ── Initials ──────────────────────────────────────────────────────────────────

describe("PresenceBar — initials", () => {
  it("shows first-letter initials for a two-word display name", () => {
    useCollabStore.setState({
      presence: [makeUser({ display_name: "Alice Wonder" })],
    });
    render(<PresenceBar />);
    expect(screen.getByText("AW")).toBeInTheDocument();
  });

  it("shows the first two characters for a single-word name", () => {
    useCollabStore.setState({
      presence: [makeUser({ display_name: "Bob" })],
    });
    render(<PresenceBar />);
    expect(screen.getByText("BO")).toBeInTheDocument();
  });

  it("shows '?' for an empty display name", () => {
    useCollabStore.setState({
      presence: [makeUser({ display_name: "" })],
    });
    render(<PresenceBar />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});

// ── Overflow ──────────────────────────────────────────────────────────────────

describe("PresenceBar — overflow", () => {
  it("caps visible avatars at 6 and shows +N for the remainder", () => {
    // 8 users, all others (not "me") → 6 visible, 2 overflow
    const users = Array.from({ length: 8 }, (_, i) =>
      makeUser({ session_id: `user-${i}`, display_name: "Anna Bell" })
    );
    useCollabStore.setState({ presence: users });
    render(<PresenceBar />);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("does not show an overflow chip when there are exactly 6 others", () => {
    const users = Array.from({ length: 6 }, (_, i) =>
      makeUser({ session_id: `user-${i}`, display_name: "Anna Bell" })
    );
    useCollabStore.setState({ presence: users });
    render(<PresenceBar />);
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });
});

// ── Tooltips ──────────────────────────────────────────────────────────────────

describe("PresenceBar — tooltips", () => {
  it("shows 'reading a scene' in the tooltip for a user viewing a scene", () => {
    useCollabStore.setState({
      presence: [makeUser({ display_name: "Alice Wonder", item_type: "scene", item_id: 5 })],
    });
    render(<PresenceBar />);
    expect(screen.getByTitle(/reading a scene/)).toBeInTheDocument();
  });

  it("shows just the display name as tooltip for a user not viewing a scene", () => {
    useCollabStore.setState({
      presence: [makeUser({ display_name: "Alice Wonder", item_type: null })],
    });
    render(<PresenceBar />);
    expect(screen.getByTitle("Alice Wonder")).toBeInTheDocument();
  });

  it("shows just the display name when item_type is set but is not 'scene'", () => {
    useCollabStore.setState({
      presence: [makeUser({ display_name: "Alice Wonder", item_type: "chapter", item_id: 3 })],
    });
    render(<PresenceBar />);
    expect(screen.getByTitle("Alice Wonder")).toBeInTheDocument();
  });
});
