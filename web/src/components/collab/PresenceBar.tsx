"use client";

import { useCollabStore } from "@/store/collabStore";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

/**
 * Compact avatar-chip strip shown in the sidebar when co-work is active.
 * Filters out the local session so you only see other people.
 */
export function PresenceBar() {
  const presence = useCollabStore((s) => s.presence);
  const myId     = useCollabStore((s) => s.mySessionId);

  const others = presence.filter((r) => r.session_id !== myId);
  if (others.length === 0) return null;

  const visible  = others.slice(0, 6);
  const overflow = others.length - visible.length;

  return (
    <div className="px-3 py-1.5 flex items-center gap-1.5 border-b border-border">
      {visible.map((r) => (
        <span
          key={r.session_id}
          className="inline-flex h-5 w-5 rounded-full items-center justify-center text-[9px] font-bold text-white shrink-0 cursor-default select-none"
          style={{ backgroundColor: r.color }}
          title={
            r.item_type === "scene" && r.item_id != null
              ? `${r.display_name} — reading a scene`
              : r.display_name
          }
        >
          {initials(r.display_name)}
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-[10px] text-muted-foreground leading-none">+{overflow}</span>
      )}
    </div>
  );
}
