import type { TimeConfig, SceneTime } from "@/types";

export function formatTimeDisplay(config: TimeConfig, time: SceneTime): string {
  const enabled = config.units.filter(u => u.enabled);
  const minuteEnabled = enabled.some(u => u.id === "minute");
  const parts: string[] = [];
  for (const unit of enabled) {
    if (unit.id === "minute") continue; // folded into the "hour" entry below
    const val = time[unit.id];
    if (unit.id === "hour") {
      if (val == null) continue;
      parts.push(formatHourMinute(val, minuteEnabled ? time["minute"] ?? 0 : undefined));
      continue;
    }
    if (val == null) continue;
    if (unit.value_names.length > 0) {
      const idx = val - 1; // value_names are 1-indexed in display
      const name = unit.value_names[idx] ?? String(val);
      parts.push(name);
    } else {
      parts.push(`${val} ${val === 1 ? unit.singular : unit.plural}`);
    }
  }
  return parts.join(", ") || "—";
}

export function getDayNight(config: TimeConfig, time: SceneTime): "Day" | "Night" | null {
  const hourUnit = config.units.find(u => u.id === "hour" && u.enabled);
  if (!hourUnit) return null;
  const hourVal = time["hour"];
  if (hourVal == null) return null;
  const minuteUnit = config.units.find(u => u.id === "minute" && u.enabled);
  const hour = minuteUnit ? hourVal + (time["minute"] ?? 0) / 60 : hourVal;
  const dn = config.day_night;
  const nightEnd = (dn.night_start_hour + dn.night_duration) % dn.hours_per_day;
  let isNight: boolean;
  if (dn.night_duration <= 0) {
    isNight = false;
  } else if (nightEnd > dn.night_start_hour) {
    isNight = hour >= dn.night_start_hour && hour < nightEnd;
  } else {
    // wraps midnight
    isNight = hour >= dn.night_start_hour || hour < nightEnd;
  }
  return isNight ? "Night" : "Day";
}

/**
 * Formats an hour value as human "HH:MM". If `minute` is given, it's used
 * directly; otherwise a fractional `hour` (e.g. 20.5) is split into H/M.
 */
export function formatHourMinute(hour: number, minute?: number | null): string {
  let h: number;
  let m: number;
  if (minute != null) {
    h = hour;
    m = minute;
  } else {
    h = Math.floor(hour);
    m = Math.round((hour - h) * 60);
  }
  h = Math.floor(((h % 24) + 24) % 24);
  m = ((Math.round(m) % 60) + 60) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Formats a fractional hour (e.g. 20.5) as 24h "HH:MM". */
export function formatHour24(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const wholeHour = Math.floor(h);
  const minutes = Math.round((h - wholeHour) * 60);
  return `${String(wholeHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Formats a fractional hour (e.g. 20.5) as 12h "H:MM AM/PM". */
export function formatHourAMPM(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const wholeHour = Math.floor(h);
  const minutes = Math.round((h - wholeHour) * 60);
  const period = wholeHour < 12 ? "AM" : "PM";
  let displayHour = wholeHour % 12;
  if (displayHour === 0) displayHour = 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${period}`;
}

/**
 * Parses a user-typed hour value into whole hour + minute parts.
 * Accepts plain integers ("8" → minute: null, no minute component given),
 * decimals with "." or "," ("8.5" / "8,5" → 8:30), and clock notation
 * ("8:30"). Returns undefined if unparseable.
 */
export function parseHourMinuteInput(raw: string): { hour: number; minute: number | null } | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const clockMatch = s.match(/^(\d{1,3}):(\d{1,2})$/);
  if (clockMatch) {
    const h = Number(clockMatch[1]);
    const m = Number(clockMatch[2]);
    if (m >= 60) return undefined;
    return { hour: h, minute: m };
  }
  const n = Number(s.replace(",", "."));
  if (isNaN(n)) return undefined;
  if (Number.isInteger(n)) return { hour: n, minute: null };
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  return { hour: h, minute: m };
}
