"use client";

import { useState, useEffect } from "react";
import { X, Plus, GripVertical, Moon, Sun, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TimeConfig, TimeUnit, DayNightConfig } from "@/types";
import { DEFAULT_TIME_CONFIG } from "@/types";
import { cn } from "@/lib/utils";
import { formatHour24, formatHourAMPM } from "@/lib/sceneTime";

interface Props {
  open: boolean;
  onClose: () => void;
  initial: TimeConfig;
  onSave: (config: TimeConfig) => void;
}

// ── Day/Night Dial ────────────────────────────────────────────────────────────

function DayNightDial({ dn, onChange }: {
  dn: DayNightConfig;
  onChange: (dn: DayNightConfig) => void;
}) {
  const [format, setFormat] = useState<"24h" | "ampm">("24h");
  const formatHour = format === "ampm" ? formatHourAMPM : formatHour24;
  const R = 80;          // radius of clock face
  const CX = 100; const CY = 100;  // centre
  const total = dn.hours_per_day;

  const toAngle = (h: number) => (h / total) * 360 - 90; // -90 so 0 = top

  const polarToXY = (angleDeg: number, r: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
  };

  // Night arc from night_start_hour for night_duration hours
  const nightStart = dn.night_start_hour;
  const nightEnd   = (nightStart + dn.night_duration) % total;

  const sweepAngle  = (dn.night_duration / total) * 360;
  const startAngle  = toAngle(nightStart);
  const endAngleDeg = startAngle + sweepAngle;

  const start = polarToXY(startAngle, R);
  const end   = polarToXY(endAngleDeg, R);
  const large = sweepAngle > 180 ? 1 : 0;

  const arcPath = `M ${CX} ${CY} L ${start.x} ${start.y} A ${R} ${R} 0 ${large} 1 ${end.x} ${end.y} Z`;

  // Hour tick labels (every 6 hours for readability)
  const ticks = [0, 6, 12, 18].filter(h => h < total);

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width="200" height="200" className="select-none">
        {/* Background circle */}
        <circle cx={CX} cy={CY} r={R} fill="hsl(var(--secondary))" stroke="hsl(var(--border))" strokeWidth="1" />
        {/* Night arc */}
        <path d={arcPath} fill="hsl(262 80% 65% / 0.25)" stroke="hsl(262 80% 65%)" strokeWidth="1.5" />
        {/* Hour ticks */}
        {ticks.map(h => {
          const angle = toAngle(h);
          const inner = polarToXY(angle, R - 8);
          const outer = polarToXY(angle, R - 1);
          const label = polarToXY(angle, R - 18);
          return (
            <g key={h}>
              <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
                stroke="hsl(var(--muted-foreground))" strokeWidth="1.5" />
              <text x={label.x} y={label.y} textAnchor="middle" dominantBaseline="central"
                fontSize="9" fill="hsl(var(--muted-foreground))">{h}</text>
            </g>
          );
        })}
        {/* Night start handle */}
        {(() => {
          const p = polarToXY(startAngle, R);
          return <circle cx={p.x} cy={p.y} r="5" fill="hsl(262 80% 65%)" className="cursor-pointer" />;
        })()}
        {/* Labels */}
        <text x={CX} y={CY - 12} textAnchor="middle" fontSize="9" fill="hsl(var(--foreground))">
          <tspan fill="hsl(38 92% 65%)">☀</tspan> Day
        </text>
        <text x={CX} y={CY + 4} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))">
          {Math.round(total - dn.night_duration)}h
        </text>
        <text x={CX} y={CY + 16} textAnchor="middle" fontSize="9" fill="hsl(262 80% 65%)">
          ☾ {Math.round(dn.night_duration)}h
        </text>
      </svg>

      {/* Inputs */}
      <div className="grid grid-cols-3 gap-3 w-full text-xs">
        <div className="space-y-1">
          <Label className="text-xs">Hours/Day</Label>
          <Input
            type="number" min={1} max={100}
            value={dn.hours_per_day}
            onChange={e => onChange({ ...dn, hours_per_day: Number(e.target.value) || 24 })}
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs flex items-center gap-1"><Moon className="h-3 w-3" /> Night starts</Label>
          <Input
            type="number" min={0} max={dn.hours_per_day - 1} step={0.5}
            value={dn.night_start_hour}
            onChange={e => onChange({ ...dn, night_start_hour: Number(e.target.value) })}
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs flex items-center gap-1"><Moon className="h-3 w-3" /> Duration</Label>
          <Input
            type="number" min={0} max={dn.hours_per_day} step={0.5}
            value={dn.night_duration}
            onChange={e => onChange({ ...dn, night_duration: Number(e.target.value) })}
            className="h-7 text-xs"
          />
        </div>
      </div>

      {/* Display format toggle, next to the float-hour inputs above */}
      <div className="flex items-center gap-1 self-end">
        <span className="text-[10px] text-muted-foreground mr-1">Display:</span>
        {(["24h", "ampm"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFormat(f)}
            className={cn(
              "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
              format === f
                ? "bg-primary text-primary-foreground border-transparent"
                : "border-border text-muted-foreground hover:border-muted-foreground/50"
            )}
          >
            {f === "24h" ? "24h" : "AM/PM"}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Night: {formatHour(dn.night_start_hour)} → {formatHour((dn.night_start_hour + dn.night_duration) % dn.hours_per_day)}
        &nbsp;·&nbsp;Day: {(dn.hours_per_day - dn.night_duration).toFixed(1)}h
      </p>
    </div>
  );
}

// ── Value Names Editor ────────────────────────────────────────────────────────

function ValueNamesEditor({ count, names, onChange }: {
  count: number;
  names: string[];
  onChange: (names: string[]) => void;
}) {
  const slots = Array.from({ length: count }, (_, i) => names[i] ?? "");
  return (
    <div className="grid grid-cols-2 gap-1 mt-1">
      {slots.map((n, i) => (
        <Input
          key={i}
          value={n}
          placeholder={`#${i + 1}`}
          className="h-7 text-xs"
          onChange={e => {
            const next = [...slots];
            next[i] = e.target.value;
            onChange(next.filter(Boolean).length > 0 ? next : []);
          }}
        />
      ))}
    </div>
  );
}

// ── Unit Row ──────────────────────────────────────────────────────────────────

function UnitRow({ unit, onChange }: {
  unit: TimeUnit;
  onChange: (u: TimeUnit) => void;
}) {
  const [showNames, setShowNames] = useState(unit.value_names.length > 0 || false);

  const nameCount = unit.count_per_parent ?? 0;

  return (
    <div className={cn(
      "border border-border rounded-lg p-3 space-y-2 transition-opacity",
      !unit.enabled && "opacity-50"
    )}>
      <div className="flex items-center gap-2">
        {/* Enable toggle */}
        <button
          onClick={() => onChange({ ...unit, enabled: !unit.enabled })}
          className={cn(
            "w-8 h-4 rounded-full transition-colors shrink-0 relative",
            unit.enabled ? "bg-primary" : "bg-secondary border border-border"
          )}
        >
          <span className={cn(
            "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow",
            unit.enabled ? "left-4.5 translate-x-0" : "left-0.5"
          )} />
        </button>

        {/* Singular */}
        <Input
          value={unit.singular}
          onChange={e => onChange({ ...unit, singular: e.target.value })}
          placeholder="Singular"
          className="h-7 text-xs w-24 shrink-0"
        />
        {/* Plural */}
        <Input
          value={unit.plural}
          onChange={e => onChange({ ...unit, plural: e.target.value })}
          placeholder="Plural"
          className="h-7 text-xs w-24 shrink-0"
        />

        {/* Count per parent */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <span>/parent:</span>
          <Input
            type="number" min={1} max={10000}
            value={unit.count_per_parent ?? ""}
            placeholder="∞"
            onChange={e => onChange({ ...unit, count_per_parent: e.target.value ? Number(e.target.value) : null })}
            className="h-7 text-xs w-20"
          />
        </div>

        {/* Custom names toggle */}
        {nameCount > 0 && nameCount <= 60 && (
          <button
            onClick={() => setShowNames(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground ml-auto"
          >
            {showNames ? "Hide names" : "Custom names"}
          </button>
        )}
      </div>

      {showNames && nameCount > 0 && nameCount <= 60 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Custom value names (leave blank to use numbers)</p>
          <ValueNamesEditor
            count={nameCount}
            names={unit.value_names}
            onChange={names => onChange({ ...unit, value_names: names })}
          />
        </div>
      )}
    </div>
  );
}

// ── Main Dialog ───────────────────────────────────────────────────────────────

export function TimeConfigDialog({ open, onClose, initial, onSave }: Props) {
  const [config, setConfig] = useState<TimeConfig>(initial);
  const [tab, setTab] = useState<"units" | "daynight">("units");

  useEffect(() => {
    if (open) setConfig(initial);
  }, [open, initial]);

  const updateUnit = (idx: number, unit: TimeUnit) => {
    const units = [...config.units];
    units[idx] = unit;
    setConfig({ ...config, units });
  };

  const handleSave = () => { onSave(config); onClose(); };
  const handleReset = () => setConfig(DEFAULT_TIME_CONFIG);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Time System</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border pb-2 shrink-0">
          {(["units", "daynight"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "text-xs px-3 py-1.5 rounded-md transition-colors",
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "units" ? "Time Units" : "Day & Night"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "units" && (
            <div className="space-y-2 pr-1">
              <p className="text-xs text-muted-foreground pb-1">
                Enable the units your story uses. Units are ordered from largest (top) to smallest (bottom).
                Rename them to fit your world. "Count per parent" sets how many of each unit fit in the one above.
              </p>
              {config.units.map((unit, i) => (
                <UnitRow key={unit.id} unit={unit} onChange={u => updateUnit(i, u)} />
              ))}
            </div>
          )}

          {tab === "daynight" && (
            <div className="flex flex-col items-center gap-4 py-2">
              <p className="text-xs text-muted-foreground text-center max-w-sm">
                Configure the day/night cycle. The purple arc shows nighttime.
                "Night starts" is the hour when darkness begins; "Duration" is how many hours it lasts.
              </p>
              <DayNightDial
                dn={config.day_night}
                onChange={dn => setConfig({ ...config, day_night: dn })}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-border shrink-0">
          <button
            onClick={handleReset}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> Reset to defaults
          </button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
