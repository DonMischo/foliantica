import { cn } from "@/lib/utils";

type P = { className?: string };

// ── STREAKS — flame progression ───────────────────────────────────────────────

// T1: tiny spark / teardrop
const Spark = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path
      fill="currentColor"
      d="M12 5 C10.5 7.5 9.5 9.5 9.5 11.5 C9.5 13.4 10.6 15 12 15 C13.4 15 14.5 13.4 14.5 11.5 C14.5 9.5 13.5 7.5 12 5Z"
    />
  </svg>
);

// T2: classic flame
const FlameS = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path
      fill="currentColor"
      d="M12 3 C10 6.5 8 9.5 8 13 A4 4 0 0016 13 C16 9.5 14 6.5 12 3Z"
    />
    <path
      fill="currentColor"
      fillOpacity=".22"
      d="M12 15.5 A2 2 0 1112 11.5 A2 2 0 0112 15.5Z"
    />
  </svg>
);

// T3: flame with inner glow core
const FlameM = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path
      fill="currentColor"
      d="M12 2 C9.5 6 7 10 7 13.5 A5 5 0 0017 13.5 C17 10 14.5 6 12 2Z"
    />
    <path
      fill="currentColor"
      fillOpacity=".28"
      d="M12 17 A3 3 0 1112 11 A3 3 0 0112 17Z"
    />
    <path
      fill="currentColor"
      d="M12 5.5 C11.2 7.5 10 9.5 10 11.5 A2 2 0 0014 11.5 C14 9.5 12.8 7.5 12 5.5Z"
      fillOpacity=".45"
    />
  </svg>
);

// T4: tall dramatic flame + side sparks
const FlameTall = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path
      fill="currentColor"
      d="M12 1.5 C9 6 6.5 10 6.5 14 A5.5 5.5 0 0017.5 14 C17.5 10 15 6 12 1.5Z"
    />
    <path
      fill="currentColor"
      fillOpacity=".22"
      d="M12 17.5 A3.5 3.5 0 1112 10.5 A3.5 3.5 0 0112 17.5Z"
    />
    {/* side sparks */}
    <line x1="3.5" y1="13.5" x2="5.5" y2="13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".7" />
    <line x1="18.5" y1="13.5" x2="20.5" y2="13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".7" />
    <line x1="4.5" y1="9.5" x2="6" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
    <line x1="19.5" y1="9.5" x2="18" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
  </svg>
);

// T5: crown of five flames
const FlameCrown = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    {/* crown band */}
    <path fill="currentColor" fillOpacity=".55" d="M3.5 21 H20.5 L18 15 L15.5 17.5 L12 14.5 L8.5 17.5 L6 15 Z" />
    {/* center flame */}
    <path fill="currentColor" d="M12 2 C11 3.5 10.5 5 10.5 6.5 A1.5 1.5 0 003 0 1.5 1.5 0 013 0 C13.5 5 13 3.5 12 2Z" />
    {/* 4 side flames */}
    <path fill="currentColor" fillOpacity=".9" d="M7 4.5 C6.2 6 5.8 7.2 5.8 8.3 A1.2 1.2 0 008.2 8.3 C8.2 7.2 7.8 6 7 4.5Z" />
    <path fill="currentColor" fillOpacity=".9" d="M17 4.5 C16.2 6 15.8 7.2 15.8 8.3 A1.2 1.2 0 0018.2 8.3 C18.2 7.2 17.8 6 17 4.5Z" />
    <path fill="currentColor" fillOpacity=".8" d="M4 7 C3.3 8 3 9 3 9.8 A1 1 0 005 9.8 C5 9 4.7 8 4 7Z" />
    <path fill="currentColor" fillOpacity=".8" d="M20 7 C19.3 8 19 9 19 9.8 A1 1 0 0021 9.8 C21 9 20.7 8 20 7Z" />
  </svg>
);

// ── WORDS — quill → tome ──────────────────────────────────────────────────────

// T1: quill feather
const Quill = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path
      fill="currentColor"
      d="M20 2 C16 2 13 5.5 10 9 L7.5 18.5 L11 16.5 L18 8 C20 5.5 21 3.5 20 2Z"
    />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M7.5 18.5 L8.5 15.5" opacity=".45" />
  </svg>
);

// T2: quill + ink drop
const QuillInk = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path
      fill="currentColor"
      d="M20 2 C16 2 13 5.5 10 9 L7.5 18.5 L11 16.5 L18 8 C20 5.5 21 3.5 20 2Z"
    />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M7.5 18.5 L8.5 15.5" opacity=".45" />
    <path fill="currentColor" fillOpacity=".5" d="M7 21 A1.5 1.5 0 107 18 A1.5 1.5 0 007 21Z" />
    <line x1="4" y1="21" x2="10" y2="21" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity=".25" />
  </svg>
);

// T3: open book with text lines
const BookOpenIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" fillOpacity=".12" x="3" y="5" width="8" height="14" rx="1" />
    <rect fill="currentColor" fillOpacity=".12" x="13" y="5" width="8" height="14" rx="1" />
    <rect stroke="currentColor" strokeWidth="1.5" x="3" y="5" width="8" height="14" rx="1" />
    <rect stroke="currentColor" strokeWidth="1.5" x="13" y="5" width="8" height="14" rx="1" />
    <line x1="11" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1.5" />
    <line x1="11" y1="19" x2="13" y2="19" stroke="currentColor" strokeWidth="1.5" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M5 9H9 M5 12H9 M5 15H8" opacity=".5" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M15 9H19 M15 12H19 M15 15H18" opacity=".5" />
  </svg>
);

// T4: stack of three books
const BookStack = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" fillOpacity=".3" x="3" y="15" width="18" height="5" rx="1" />
    <rect fill="currentColor" fillOpacity=".55" x="4" y="10" width="16" height="5" rx="1" />
    <rect fill="currentColor" x="5" y="5" width="14" height="5" rx="1" />
    <line x1="8" y1="5" x2="8" y2="10" stroke="currentColor" strokeWidth="1" opacity=".3" />
    <line x1="9" y1="10" x2="9" y2="15" stroke="currentColor" strokeWidth="1" opacity=".3" />
    <line x1="10" y1="15" x2="10" y2="20" stroke="currentColor" strokeWidth="1" opacity=".3" />
  </svg>
);

// T5: ancient tome with radiating rays
const TomeGlowing = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" x="4" y="3" width="14" height="18" rx="1.5" />
    <rect fill="currentColor" fillOpacity=".2" x="2" y="5" width="3.5" height="14" rx="1" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M7 8H15 M7 11H15 M7 14H12" opacity=".3" />
    {/* rays */}
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M12 1V2.5" opacity=".6" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M19.5 5.5L18.5 6.5" opacity=".5" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M22 12H20.5" opacity=".5" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M19.5 18.5L18.5 17.5" opacity=".4" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M4.5 5.5L5.5 6.5" opacity=".5" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M2 12H3.5" opacity=".5" />
  </svg>
);

// ── BEST DAY — speed progression ──────────────────────────────────────────────

// T1: pen making a stroke
const PenStroke = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" d="M5.5 15.5 L14 7 L17 10 L8.5 18.5 L5.5 18.5 Z" />
    <path fill="currentColor" fillOpacity=".4" d="M14 7 L16 5 L19 8 L17 10 Z" />
    <line x1="3" y1="21" x2="21" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".4" />
  </svg>
);

// T2: lightning bolt
const LightningBolt = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" d="M13 2 L4 14 H11 L9 22 L20 10 H13 Z" />
  </svg>
);

// T3: rocket
const RocketIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" d="M12 2 C10 4.5 8 8 8 12 H16 C16 8 14 4.5 12 2Z" />
    <path fill="currentColor" fillOpacity=".65" d="M8 12 H16 L14.5 19 H9.5 Z" />
    <path fill="currentColor" fillOpacity=".4" d="M8 13 L6 15.5 L8 17.5 Z" />
    <path fill="currentColor" fillOpacity=".4" d="M16 13 L18 15.5 L16 17.5 Z" />
    <path fill="currentColor" fillOpacity=".55" d="M9.5 19 L8.5 22.5 L12 21 L15.5 22.5 L14.5 19 Z" />
    <circle fill="currentColor" fillOpacity=".5" cx="12" cy="9" r="1.5" />
  </svg>
);

// T4: meteor with trail
const MeteorIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle fill="currentColor" cx="16.5" cy="7.5" r="4" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M2 22 L11 13" opacity=".7" />
    <path stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M4 19.5 L9 14.5" opacity=".5" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M2 16 L6 12" opacity=".35" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M11 4 L13 2" opacity=".4" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M20 3 L22 4" opacity=".4" />
  </svg>
);

// T5+: legendary word-count icons ─────────────────────────────────────────────

// 2M: tome inside a supernova ring
const TomeNova = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" x="5" y="4" width="12" height="16" rx="1.5" />
    <rect fill="currentColor" fillOpacity=".2" x="3" y="6" width="3" height="12" rx="1" />
    <path stroke="currentColor" strokeWidth=".9" strokeLinecap="round" d="M8 9H14 M8 12H14 M8 15H11" opacity=".28" />
    {/* supernova ring */}
    <circle stroke="currentColor" strokeWidth="1" cx="12" cy="12" r="10.5" fill="none" strokeOpacity=".25" />
    {/* 8 radial spikes */}
    {[0,45,90,135,180,225,270,315].map((deg, i) => {
      const r = (deg * Math.PI) / 180;
      const x1 = 12 + 11 * Math.cos(r), y1 = 12 + 11 * Math.sin(r);
      const x2 = 12 + 12.5 * Math.cos(r), y2 = 12 + 12.5 * Math.sin(r);
      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".6" />;
    })}
  </svg>
);

// 5M+: quill + galaxy spiral
const WordGalaxy = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    {/* spiral arms (simplified) */}
    <path stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round"
      d="M12 12 Q16 8 18 4" strokeOpacity=".5" />
    <path stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round"
      d="M12 12 Q8 16 6 20" strokeOpacity=".5" />
    <path stroke="currentColor" strokeWidth=".8" fill="none" strokeLinecap="round"
      d="M12 12 Q6 9 3 6" strokeOpacity=".35" />
    <path stroke="currentColor" strokeWidth=".8" fill="none" strokeLinecap="round"
      d="M12 12 Q18 15 21 18" strokeOpacity=".35" />
    {/* stars scattered */}
    <circle fill="currentColor" cx="18" cy="4"  r="1.3" fillOpacity=".9" />
    <circle fill="currentColor" cx="6"  cy="20" r="1.1" fillOpacity=".8" />
    <circle fill="currentColor" cx="3"  cy="6"  r="0.9" fillOpacity=".6" />
    <circle fill="currentColor" cx="21" cy="18" r="0.9" fillOpacity=".6" />
    <circle fill="currentColor" cx="20" cy="9"  r="0.7" fillOpacity=".4" />
    <circle fill="currentColor" cx="4"  cy="15" r="0.7" fillOpacity=".4" />
    {/* centre: quill tip */}
    <path fill="currentColor" d="M12 12 C11 10 10 8.5 11.5 7.5 C13 6.5 14.5 8 13.5 10 Z" />
    <path stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M12 12 L10.5 15" opacity=".55" />
  </svg>
);

// ── CODEX ENTRIES — page → cosmic tome ───────────────────────────────────────

// T1: single page with dog-ear
const PageLeaf = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" fillOpacity=".9" d="M6 3 H15 L18 6 V21 H6 Z" />
    <path fill="currentColor" fillOpacity=".25" d="M15 3 L18 6 H15 Z" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M9 9H15 M9 12H15 M9 15H13" opacity=".4" />
  </svg>
);

// T2: slim closed book
const BookClosed = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" x="5" y="3" width="13" height="18" rx="1" />
    <rect fill="currentColor" fillOpacity=".2" x="3" y="5" width="3.5" height="14" rx="1" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M9 8H15 M9 11H15 M9 14H13" opacity=".35" />
  </svg>
);

// T3: thick book with visible spine and bookmark
const BookThick = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" x="4" y="3" width="14" height="18" rx="1" />
    <rect fill="currentColor" fillOpacity=".3" x="2" y="5" width="3.5" height="14" rx="1" />
    <rect fill="currentColor" fillOpacity=".15" x="18" y="4" width="2.5" height="16" rx="1" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M8 8H14 M8 11H14 M8 14H12" opacity=".35" />
    {/* bookmark */}
    <path fill="currentColor" fillOpacity=".5" d="M14 3 V9 L16 7.5 L18 9 V3 Z" />
  </svg>
);

// T4: tome with lock clasp
const TomeLock = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" x="3" y="3" width="15" height="18" rx="1" />
    <rect fill="currentColor" fillOpacity=".25" x="1.5" y="5" width="3" height="14" rx="1" />
    <rect fill="currentColor" fillOpacity=".12" x="18" y="4" width="3" height="16" rx="1" />
    {/* lock body */}
    <rect fill="currentColor" x="7.5" y="12" width="7" height="5" rx="1" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M9.5 12 V10.5 A2.5 2.5 0 0112.5 10.5 V12" />
    <circle fill="currentColor" fillOpacity=".3" cx="11" cy="14.5" r="1" />
  </svg>
);

// T5: floating tome with constellation stars
const TomeStars = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" x="3" y="4" width="14" height="17" rx="1" />
    <rect fill="currentColor" fillOpacity=".25" x="1.5" y="6" width="3" height="13" rx="1" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M6 10H14 M6 13H14 M6 16H11" opacity=".3" />
    {/* stars */}
    <path fill="currentColor" d="M19.5 2 L20.1 3.8 H22 L20.5 4.9 L21.1 6.7 L19.5 5.6 L17.9 6.7 L18.5 4.9 L17 3.8 H18.9 Z" fillOpacity=".9" />
    <circle fill="currentColor" fillOpacity=".55" cx="21.5" cy="9.5" r="1" />
    <circle fill="currentColor" fillOpacity=".4" cx="20.5" cy="13" r=".7" />
    <circle fill="currentColor" fillOpacity=".3" cx="22" cy="16" r=".6" />
  </svg>
);

// ── CODEX RELATIONS — node networks ──────────────────────────────────────────

// T1: two nodes + line
const TwoNodes = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle fill="currentColor" cx="6" cy="12" r="3" />
    <circle fill="currentColor" cx="18" cy="12" r="3" />
    <line x1="9" y1="12" x2="15" y2="12" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

// T2: triangle of three nodes
const TriangleNet = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <line x1="12" y1="5.5" x2="5" y2="17.5" stroke="currentColor" strokeWidth="1.2" opacity=".65" />
    <line x1="12" y1="5.5" x2="19" y2="17.5" stroke="currentColor" strokeWidth="1.2" opacity=".65" />
    <line x1="5" y1="17.5" x2="19" y2="17.5" stroke="currentColor" strokeWidth="1.2" opacity=".65" />
    <circle fill="currentColor" cx="12" cy="5.5" r="2.5" />
    <circle fill="currentColor" cx="5" cy="17.5" r="2.5" />
    <circle fill="currentColor" cx="19" cy="17.5" r="2.5" />
  </svg>
);

// T3: six-node star network (hub + 5 spokes)
const StarNet = ({ className }: P) => {
  const outer = [0, 72, 144, 216, 288].map((deg) => {
    const r = (deg * Math.PI) / 180;
    return { x: 12 + 8 * Math.cos(r - Math.PI / 2), y: 12 + 8 * Math.sin(r - Math.PI / 2) };
  });
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {outer.map((n, i) => (
        <line key={i} x1="12" y1="12" x2={n.x} y2={n.y} stroke="currentColor" strokeWidth="1.2" opacity=".6" />
      ))}
      {outer.map((n, i) => {
        const next = outer[(i + 1) % outer.length];
        return <line key={`r${i}`} x1={n.x} y1={n.y} x2={next.x} y2={next.y} stroke="currentColor" strokeWidth=".9" opacity=".35" />;
      })}
      {outer.map((n, i) => <circle key={`c${i}`} fill="currentColor" cx={n.x} cy={n.y} r="2" fillOpacity=".85" />)}
      <circle fill="currentColor" cx="12" cy="12" r="2.5" />
    </svg>
  );
};

// T4: dense hexagonal network
const DenseNet = ({ className }: P) => {
  const nodes = [0, 60, 120, 180, 240, 300].map((deg) => {
    const r = (deg * Math.PI) / 180;
    return { x: 12 + 7.5 * Math.cos(r), y: 12 + 7.5 * Math.sin(r) };
  });
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {nodes.map((n, i) => (
        <line key={`s${i}`} x1="12" y1="12" x2={n.x} y2={n.y} stroke="currentColor" strokeWidth="1" opacity=".5" />
      ))}
      {nodes.map((n, i) => {
        const next = nodes[(i + 1) % nodes.length];
        return <line key={`r${i}`} x1={n.x} y1={n.y} x2={next.x} y2={next.y} stroke="currentColor" strokeWidth=".9" opacity=".4" />;
      })}
      {nodes.map((n, i) => <circle key={`c${i}`} fill="currentColor" cx={n.x} cy={n.y} r="1.7" fillOpacity=".8" />)}
      <circle fill="currentColor" cx="12" cy="12" r="2.2" />
    </svg>
  );
};

// T5: two-ring cosmic web
const CosmicNet = ({ className }: P) => {
  const inner = [0, 90, 180, 270].map((deg) => {
    const r = (deg * Math.PI) / 180;
    return { x: 12 + 4.5 * Math.cos(r), y: 12 + 4.5 * Math.sin(r) };
  });
  const outer = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
    const r = (deg * Math.PI) / 180;
    return { x: 12 + 9 * Math.cos(r), y: 12 + 9 * Math.sin(r) };
  });
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {inner.map((n, i) => (
        <line key={`is${i}`} x1="12" y1="12" x2={n.x} y2={n.y} stroke="currentColor" strokeWidth="1.1" opacity=".55" />
      ))}
      {outer.map((n, i) => (
        <line key={`os${i}`} x1="12" y1="12" x2={n.x} y2={n.y} stroke="currentColor" strokeWidth=".7" opacity=".25" />
      ))}
      {inner.map((a, i) => {
        const b = inner[(i + 1) % inner.length];
        return <line key={`ir${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeWidth=".9" opacity=".4" />;
      })}
      {outer.map((a, i) => {
        const b = outer[(i + 1) % outer.length];
        return <line key={`or${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeWidth=".7" opacity=".3" />;
      })}
      {inner.map((n, i) => <circle key={`ic${i}`} fill="currentColor" cx={n.x} cy={n.y} r="1.6" fillOpacity=".75" />)}
      {outer.map((n, i) => <circle key={`oc${i}`} fill="currentColor" cx={n.x} cy={n.y} r="1.1" fillOpacity=".55" />)}
      <circle fill="currentColor" cx="12" cy="12" r="2.3" />
    </svg>
  );
};

// ── CODEX MENTIONED — presence in prose ──────────────────────────────────────

// T1: ghostly silhouette
const ShadowFigure = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle fill="currentColor" fillOpacity=".28" cx="12" cy="7" r="3.5" />
    <path fill="currentColor" fillOpacity=".28" d="M5.5 20 C5.5 16.1 8.4 13 12 13 S18.5 16.1 18.5 20 Z" />
  </svg>
);

// T2: figure outline
const FigureOutline = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle stroke="currentColor" strokeWidth="1.5" cx="12" cy="7" r="3.5" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M5.5 20 C5.5 16.1 8.4 13 12 13 S18.5 16.1 18.5 20" />
  </svg>
);

// T3: two figures
const TwoFigures = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle fill="currentColor" cx="9" cy="7" r="3" />
    <path fill="currentColor" d="M2.5 19.5 C2.5 16 5.4 13.5 9 13.5 S15.5 16 15.5 19.5 Z" />
    <circle fill="currentColor" fillOpacity=".55" cx="17" cy="7.5" r="2.3" />
    <path fill="currentColor" fillOpacity=".55" d="M13.5 19.5 C13.5 16.5 15.5 14 17 14 S21.5 16.5 21.5 19.5 Z" />
  </svg>
);

// T4: three figures
const GroupFigures = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    {/* left */}
    <circle fill="currentColor" fillOpacity=".5" cx="4.5" cy="8" r="2.2" />
    <path fill="currentColor" fillOpacity=".5" d="M1 19.5 C1 16.5 2.8 14.5 4.5 14.5 S8 16.5 8 19.5 Z" />
    {/* center */}
    <circle fill="currentColor" cx="12" cy="7" r="3" />
    <path fill="currentColor" d="M5.5 19.5 C5.5 16 8.4 13.5 12 13.5 S18.5 16 18.5 19.5 Z" />
    {/* right */}
    <circle fill="currentColor" fillOpacity=".5" cx="19.5" cy="8" r="2.2" />
    <path fill="currentColor" fillOpacity=".5" d="M16 19.5 C16 16.5 17.8 14.5 19.5 14.5 S23 16.5 23 19.5 Z" />
  </svg>
);

// T5: glowing cast with radiance
const GlowingCast = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle fill="currentColor" fillOpacity=".4" cx="4.5" cy="8" r="2" />
    <path fill="currentColor" fillOpacity=".4" d="M1 19.5 C1 16.8 2.6 14.8 4.5 14.8 S8 16.8 8 19.5 Z" />
    <circle fill="currentColor" cx="12" cy="6.5" r="3" />
    <path fill="currentColor" d="M5.5 19.5 C5.5 16 8.4 13.5 12 13.5 S18.5 16 18.5 19.5 Z" />
    <circle fill="currentColor" fillOpacity=".4" cx="19.5" cy="8" r="2" />
    <path fill="currentColor" fillOpacity=".4" d="M16 19.5 C16 16.8 17.6 14.8 19.5 14.8 S23 16.8 23 19.5 Z" />
    {/* radiance rays */}
    <path stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M12 2V4" opacity=".6" />
    <path stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M15.5 3L14.7 4.5" opacity=".5" />
    <path stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M8.5 3L9.3 4.5" opacity=".5" />
  </svg>
);

// ── PROJECTS ──────────────────────────────────────────────────────────────────

// T1: single folder
const FolderSingle = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" d="M4 6.5 H9.5 L11.5 8.5 H20 V19 H4 Z" />
  </svg>
);

// T2: two overlapping folders
const FolderDouble = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" fillOpacity=".4" d="M2 8 H7 L8.5 9.5 H14 V18 H2 Z" />
    <path fill="currentColor" d="M6 5.5 H11.5 L13.5 7.5 H21 V18 H6 Z" />
  </svg>
);

// T3: bookshelf
const Bookshelf = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <line x1="2" y1="21" x2="22" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <rect fill="currentColor" x="3" y="5" width="3" height="16" rx=".5" />
    <rect fill="currentColor" fillOpacity=".7" x="7" y="8" width="3" height="13" rx=".5" />
    <rect fill="currentColor" fillOpacity=".85" x="11" y="6" width="4" height="15" rx=".5" />
    <rect fill="currentColor" fillOpacity=".6" x="16.5" y="10" width="2.5" height="11" rx=".5" />
    <rect fill="currentColor" fillOpacity=".5" x="20" y="7" width="2" height="14" rx=".5" />
  </svg>
);

// ── SCENES ────────────────────────────────────────────────────────────────────

// T1: single card
const SceneCard = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" fillOpacity=".15" x="5" y="4" width="14" height="16" rx="2" />
    <rect stroke="currentColor" strokeWidth="1.5" x="5" y="4" width="14" height="16" rx="2" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M8 9H16 M8 12H16 M8 15H13" opacity=".5" />
  </svg>
);

// T2: three fanned cards
const SceneCards = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" fillOpacity=".25" x="2" y="8" width="11" height="13" rx="1.5" />
    <rect fill="currentColor" fillOpacity=".45" x="5" y="6" width="11" height="13" rx="1.5" />
    <rect fill="currentColor" x="9" y="4" width="11" height="13" rx="1.5" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M12 7H18 M12 10H18 M12 13H16" opacity=".35" />
  </svg>
);

// T3: corkboard grid
const SceneBoard = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" fillOpacity=".1" x="2" y="2" width="20" height="20" rx="2" />
    <rect stroke="currentColor" strokeWidth="1" x="2" y="2" width="20" height="20" rx="2" opacity=".4" />
    <rect fill="currentColor" fillOpacity=".7" x="4" y="4" width="7" height="7" rx="1" />
    <rect fill="currentColor" fillOpacity=".7" x="13" y="4" width="7" height="5" rx="1" />
    <rect fill="currentColor" fillOpacity=".7" x="4" y="13" width="5" height="7" rx="1" />
    <rect fill="currentColor" fillOpacity=".7" x="11" y="11" width="9" height="9" rx="1" />
    <circle fill="currentColor" cx="7.5" cy="7.5" r=".7" fillOpacity=".5" />
    <circle fill="currentColor" cx="16.5" cy="6.5" r=".7" fillOpacity=".5" />
    <circle fill="currentColor" cx="6.5" cy="16.5" r=".7" fillOpacity=".5" />
    <circle fill="currentColor" cx="15.5" cy="15.5" r=".7" fillOpacity=".5" />
  </svg>
);

// T4: dense multi-column scene board
const SceneInfinite = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" fillOpacity=".08" x="1" y="2" width="22" height="20" rx="2" />
    <rect fill="currentColor" fillOpacity=".55" x="2" y="3.5" width="5" height="7" rx="1" />
    <rect fill="currentColor" fillOpacity=".55" x="9" y="3.5" width="5" height="5" rx="1" />
    <rect fill="currentColor" fillOpacity=".55" x="16" y="3.5" width="6" height="8" rx="1" />
    <rect fill="currentColor" fillOpacity=".55" x="2" y="12" width="6" height="9" rx="1" />
    <rect fill="currentColor" fillOpacity=".55" x="10" y="10.5" width="5" height="6.5" rx="1" />
    <rect fill="currentColor" fillOpacity=".55" x="17" y="13.5" width="5" height="7.5" rx="1" />
    <path stroke="currentColor" strokeWidth=".8" strokeLinecap="round" d="M4.5 10.5 L11.5 9 M11.5 9 L19 11.5" opacity=".4" />
  </svg>
);

// ── SCENE TYPES — palette ─────────────────────────────────────────────────────

// T3: 5-segment pie/palette
const Palette5Icon = ({ className }: P) => {
  // 5 segments at 72° each — pre-computed arc endpoints
  const r = 9;
  const cx = 12, cy = 12;
  const segments = [0, 72, 144, 216, 288].map((startDeg, i) => {
    const endDeg = startDeg + 72;
    const s = (startDeg * Math.PI) / 180 - Math.PI / 2;
    const e = (endDeg * Math.PI) / 180 - Math.PI / 2;
    const x1 = cx + r * Math.cos(s);
    const y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e);
    const y2 = cy + r * Math.sin(e);
    const opacity = 0.25 + i * 0.17;
    return { x1, y1, x2, y2, opacity };
  });
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {segments.map((seg, i) => (
        <path
          key={i}
          fill="currentColor"
          fillOpacity={seg.opacity}
          d={`M${cx},${cy} L${seg.x1},${seg.y1} A${r},${r} 0 0,1 ${seg.x2},${seg.y2} Z`}
        />
      ))}
      <circle fill="currentColor" cx={cx} cy={cy} r="3" />
      <circle stroke="currentColor" strokeWidth="1" cx={cx} cy={cy} r={r} fill="none" opacity=".3" />
    </svg>
  );
};

// ── PUBLISHING — query pipeline ───────────────────────────────────────────────

// T1: plain envelope
const Envelope = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" fillOpacity=".15" x="3" y="7" width="18" height="13" rx="2" />
    <rect stroke="currentColor" strokeWidth="1.5" x="3" y="7" width="18" height="13" rx="2" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M3 8.5 L12 15 L21 8.5" />
  </svg>
);

// T2: envelope with send arrow
const EnvelopeSent = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" fillOpacity=".15" x="2" y="9" width="16" height="12" rx="2" />
    <rect stroke="currentColor" strokeWidth="1.5" x="2" y="9" width="16" height="12" rx="2" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M2 10.5 L10 16.5 L18 10.5" />
    {/* arrow */}
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M16 5 L22 2" opacity=".8" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M22 2 L20.5 5.5 M22 2 L18.5 3.5" opacity=".8" />
  </svg>
);

// T3: pile of envelopes
const EnvelopeStack = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" fillOpacity=".22" x="1" y="12" width="16" height="10" rx="1.5" />
    <rect fill="currentColor" fillOpacity=".4" x="3" y="9.5" width="16" height="10" rx="1.5" />
    <rect fill="currentColor" x="5" y="7" width="16" height="10" rx="1.5" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M5 8.5 L13 14 L21 8.5" />
  </svg>
);

// T4: gold envelope with star
const EnvelopeGold = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" x="3" y="7" width="18" height="13" rx="2" />
    <path fill="currentColor" fillOpacity=".2" d="M3 8.5 L12 15 L21 8.5 Z" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M3 8.5 L12 15 L21 8.5" />
    {/* star */}
    <path fill="currentColor" d="M20 1.5 L20.6 3.3 H22.5 L21 4.4 L21.6 6.2 L20 5.1 L18.4 6.2 L19 4.4 L17.5 3.3 H19.4 Z" />
  </svg>
);

// T5: trophy cup
const TrophyCup = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" d="M7 3 H17 V11 A5 5 0 017 11 Z" />
    <path fill="currentColor" fillOpacity=".45" d="M3 4.5 H7 V9.5 A4 4 0 013 5.5 Z" />
    <path fill="currentColor" fillOpacity=".45" d="M17 4.5 H21 V5.5 A4 4 0 0117 9.5 Z" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M12 16 V19" />
    <rect fill="currentColor" x="8" y="19" width="8" height="2" rx="1" />
    {/* laurel leaves */}
    <path stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M7 14 C5 13 4 11 5 9" opacity=".5" />
    <path stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M17 14 C19 13 20 11 19 9" opacity=".5" />
  </svg>
);

// ── RESEARCH ──────────────────────────────────────────────────────────────────

// T1: magnifying glass
const MagGlass = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle stroke="currentColor" strokeWidth="1.5" cx="10.5" cy="10.5" r="6.5" />
    <line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// T2: magnifier over open book
const MagBook = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" fillOpacity=".15" x="2" y="6" width="11" height="14" rx="1" />
    <rect stroke="currentColor" strokeWidth="1.2" x="2" y="6" width="11" height="14" rx="1" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M4.5 10H10.5 M4.5 13H10.5 M4.5 16H8.5" opacity=".5" />
    <circle stroke="currentColor" strokeWidth="1.5" cx="17" cy="13" r="4.5" />
    <line x1="20.2" y1="16.2" x2="22.5" y2="18.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// T3: books + magnifier with crosshair
const ScholarGlass = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" x="1.5" y="9" width="3" height="13" rx=".5" />
    <rect fill="currentColor" fillOpacity=".75" x="5.5" y="6.5" width="3.5" height="15.5" rx=".5" />
    <circle stroke="currentColor" strokeWidth="1.5" cx="16.5" cy="11" r="5.5" />
    <line x1="20.4" y1="14.9" x2="22.5" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M14 11H19 M16.5 8.5V13.5" opacity=".5" />
  </svg>
);

// T4: ornate magnifier + full bookshelf
const Librarian = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <line x1="1" y1="22" x2="12" y2="22" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity=".4" />
    <rect fill="currentColor" x="1.5" y="12" width="2.5" height="10" rx=".5" />
    <rect fill="currentColor" fillOpacity=".8" x="5" y="9" width="2.5" height="13" rx=".5" />
    <rect fill="currentColor" fillOpacity=".9" x="8.5" y="11" width="2" height="11" rx=".5" />
    <circle stroke="currentColor" strokeWidth="1.5" cx="17" cy="10" r="5.5" />
    <line x1="20.9" y1="13.9" x2="23" y2="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M14.5 10H19.5 M17 7.5V12.5" opacity=".5" />
    {/* ornate handle flourish */}
    <path fill="currentColor" fillOpacity=".6" d="M17 4 L17.4 2.8 H18.8 L17.7 3.6 L18.1 4.8 L17 4.1 L15.9 4.8 L16.3 3.6 L15.2 2.8 H16.6 Z" />
  </svg>
);

// ── TIMELINE — dot → epic ─────────────────────────────────────────────────────

// T1: single dot on a line
const TimelineDot = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".4" />
    <circle fill="currentColor" cx="12" cy="12" r="3.5" />
  </svg>
);

// T2: three dots on a line
const TimelineThree = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".4" />
    <circle fill="currentColor" cx="6" cy="12" r="2.5" fillOpacity=".55" />
    <circle fill="currentColor" cx="12" cy="12" r="3" />
    <circle fill="currentColor" cx="18" cy="12" r="2.5" fillOpacity=".55" />
  </svg>
);

// T3: multi-track timeline
const TimelineTracks = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <line x1="3" y1="8"  x2="21" y2="8"  stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".3" />
    <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".3" />
    <line x1="3" y1="16" x2="21" y2="16" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".3" />
    <circle fill="currentColor" cx="7"  cy="8"  r="2.2" />
    <circle fill="currentColor" cx="15" cy="8"  r="2.2" fillOpacity=".65" />
    <circle fill="currentColor" cx="6"  cy="12" r="2.2" fillOpacity=".65" />
    <circle fill="currentColor" cx="16" cy="12" r="2.2" />
    <circle fill="currentColor" cx="10" cy="16" r="2.2" />
    <circle fill="currentColor" cx="19" cy="16" r="2.2" fillOpacity=".65" />
  </svg>
);

// T4: dense multi-track with connections
const TimelineEpic = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <line x1="2" y1="7"  x2="22" y2="7"  stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity=".25" />
    <line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity=".25" />
    <line x1="2" y1="17" x2="22" y2="17" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity=".25" />
    <line x1="9" y1="7" x2="9" y2="12"  stroke="currentColor" strokeWidth=".8" opacity=".4" />
    <line x1="15" y1="12" x2="15" y2="17" stroke="currentColor" strokeWidth=".8" opacity=".4" />
    <circle fill="currentColor" cx="5"  cy="7"  r="2" />
    <circle fill="currentColor" cx="14" cy="7"  r="1.8" fillOpacity=".65" />
    <circle fill="currentColor" cx="20" cy="7"  r="1.8" fillOpacity=".65" />
    <circle fill="currentColor" cx="7"  cy="12" r="1.8" fillOpacity=".65" />
    <circle fill="currentColor" cx="15" cy="12" r="2" />
    <circle fill="currentColor" cx="9"  cy="17" r="1.8" fillOpacity=".65" />
    <circle fill="currentColor" cx="19" cy="17" r="2" />
  </svg>
);

// ── SNIPPETS / FRAGMENTS — note → archive ─────────────────────────────────────

// T1: torn note
const SnippetNote = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" fillOpacity=".15" d="M5 5 H19 V20 H5 Z" />
    <path stroke="currentColor" strokeWidth="1.5" d="M5 5 H19 V20 H5 Z" />
    <path fill="currentColor" fillOpacity=".4" d="M5 5 L5 8 L8 6 L11 8 L14 6 L17 8 L19 6 L19 5 Z" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M8 12H16 M8 15H14" opacity=".5" />
  </svg>
);

// T2: stack of notes
const SnippetStack = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" fillOpacity=".18" x="2" y="8" width="13" height="14" rx="1" />
    <rect fill="currentColor" fillOpacity=".38" x="4" y="6" width="13" height="14" rx="1" />
    <rect fill="currentColor" fillOpacity=".9" x="6" y="4" width="13" height="14" rx="1" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M9 8H16 M9 11H16 M9 14H13" opacity=".35" />
  </svg>
);

// T3: filing archive box
const SnippetArchive = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" x="2" y="7" width="20" height="4" rx="1" />
    <rect fill="currentColor" fillOpacity=".15" x="3" y="11" width="18" height="10" rx="1" />
    <rect stroke="currentColor" strokeWidth="1.5" x="3" y="11" width="18" height="10" rx="1" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M10 15H14" opacity=".5" />
    <rect fill="currentColor" fillOpacity=".5" x="5" y="4" width="4" height="4" rx=".5" />
    <rect fill="currentColor" fillOpacity=".5" x="10" y="4.5" width="4" height="3.5" rx=".5" />
    <rect fill="currentColor" fillOpacity=".5" x="15" y="4" width="4" height="4" rx=".5" />
  </svg>
);

// ── TYPED SCENES — tag → master ───────────────────────────────────────────────

// T1: single label tag
const TagSingle = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" d="M4 6 H14 L21 12 L14 18 H4 Z" />
    <circle fill="currentColor" fillOpacity=".25" cx="8.5" cy="12" r="2" />
  </svg>
);

// T2: two overlapping tags
const TagDouble = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" fillOpacity=".38" d="M2 9 H11 L17 15 L11 21 H2 Z" />
    <path fill="currentColor" d="M5 3 H14 L20 9 L14 15 H5 Z" />
    <circle fill="currentColor" fillOpacity=".25" cx="9" cy="9" r="1.8" />
  </svg>
);

// T3: fan of tags
const TagFan = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" fillOpacity=".22" d="M1 10 H9  L14 15 L9  20 H1 Z" />
    <path fill="currentColor" fillOpacity=".5"  d="M3 7  H11 L17 12 L11 17 H3 Z" />
    <path fill="currentColor"                   d="M6 4  H14 L20 9  L14 14 H6 Z" />
    <circle fill="currentColor" fillOpacity=".25" cx="10" cy="9" r="1.5" />
  </svg>
);

// T4: grid of four tags (master plotter)
const TagMaster = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor"                   d="M2 3  H8  L11 6  L8  9  H2 Z" />
    <path fill="currentColor" fillOpacity=".7"  d="M12 3  H18 L21 6  L18 9  H12 Z" />
    <path fill="currentColor" fillOpacity=".5"  d="M2 13 H8  L11 16 L8  19 H2 Z" />
    <path fill="currentColor" fillOpacity=".35" d="M12 13 H18 L21 16 L18 19 H12 Z" />
    <circle fill="currentColor" fillOpacity=".3" cx="5.5" cy="6" r="1.2" />
    <circle fill="currentColor" fillOpacity=".3" cx="5.5" cy="16" r="1.2" />
  </svg>
);

// ── TIME SYSTEM — clock + gear ────────────────────────────────────────────────

const TimeLordIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle stroke="currentColor" strokeWidth="1.5" cx="10" cy="11" r="7.5" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M10 7.5V11L13 13" />
    {/* gear at bottom-right */}
    <circle fill="currentColor" cx="18.5" cy="18.5" r="3.5" />
    <circle stroke="currentColor" strokeWidth="1" fill="none" cx="18.5" cy="18.5" r="1.5" />
    <rect fill="currentColor" x="17.8" y="14.2" width="1.4" height="1.6" rx=".3" />
    <rect fill="currentColor" x="17.8" y="21.2" width="1.4" height="1.6" rx=".3" />
    <rect fill="currentColor" x="14.2" y="17.8" width="1.6" height="1.4" rx=".3" />
    <rect fill="currentColor" x="21.2" y="17.8" width="1.6" height="1.4" rx=".3" />
  </svg>
);

// ── PROJECT INFO — document forms ─────────────────────────────────────────────

// T1: document with info symbol
const InfoDoc = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" fillOpacity=".12" d="M5 3 H15 L19 7 V21 H5 Z" />
    <path stroke="currentColor" strokeWidth="1.5" d="M5 3 H15 L19 7 V21 H5 Z" />
    <path fill="currentColor" fillOpacity=".22" d="M15 3 L19 7 H15 Z" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M8 15H16 M8 18H13" opacity=".4" />
    <circle fill="currentColor" cx="12" cy="9" r="1.2" />
    <line x1="12" y1="11.5" x2="12" y2="13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// T3: document with checkmark (submission ready)
const CompleteDoc = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" fillOpacity=".12" d="M5 2 H15 L19 6 V22 H5 Z" />
    <path stroke="currentColor" strokeWidth="1.5" d="M5 2 H15 L19 6 V22 H5 Z" />
    <path fill="currentColor" fillOpacity=".22" d="M15 2 L19 6 H15 Z" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M8 10H15 M8 13H12" opacity=".35" />
    <path stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" d="M8 18 L11 21 L17 15" />
  </svg>
);

// ── GRAMMAR CHECK ─────────────────────────────────────────────────────────────

const GrammarCheck = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M3 7H13 M3 11H10" opacity=".5" />
    {/* wavy underline */}
    <path stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"
      d="M3 15 Q4.5 13.5 6 15 Q7.5 16.5 9 15 Q10.5 13.5 12 15" opacity=".65" />
    {/* checkmark */}
    <path stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" d="M14 13 L17 17 L22 9" />
  </svg>
);

// ── PANDOC / CONVERT ──────────────────────────────────────────────────────────

const PandocConvert = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" fillOpacity=".12" d="M4 3 H13 L17 7 V19 H4 Z" />
    <path stroke="currentColor" strokeWidth="1.5" d="M4 3 H13 L17 7 V19 H4 Z" />
    <path fill="currentColor" fillOpacity=".22" d="M13 3 L17 7 H13 Z" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M7 11H14 M7 14H11" opacity=".4" />
    {/* export arrow top-right */}
    <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M17 10 L22 5" opacity=".9" />
    <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M18.5 5 H22 V8.5" opacity=".9" />
  </svg>
);

// ── INVENTORY — pouch → chest ─────────────────────────────────────────────────

// T1: small pouch
const PouchIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" d="M8.5 8 Q8.5 4.5 12 4.5 Q15.5 4.5 15.5 8 L17.5 21 H6.5 Z" />
    <path stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M10 6.5 L14 6.5" opacity=".4" />
  </svg>
);

// T2: backpack
const BackpackIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" fillOpacity=".12" x="5" y="7" width="14" height="14" rx="2" />
    <rect stroke="currentColor" strokeWidth="1.5" x="5" y="7" width="14" height="14" rx="2" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M9 7 Q9 4 12 4 Q15 4 15 7" />
    <rect stroke="currentColor" strokeWidth="1" x="8" y="13" width="8" height="5" rx="1" opacity=".5" />
    <path stroke="currentColor" strokeWidth="1" strokeLinecap="round" d="M10 15.5 H14" opacity=".4" />
  </svg>
);

// T3: treasure chest
const ChestIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" fillOpacity=".35" d="M3 5 H21 V12 Q12 13.5 3 12 Z" />
    <path stroke="currentColor" strokeWidth="1.5" d="M3 5 H21 V12 Q12 13.5 3 12 Z" />
    <rect fill="currentColor" fillOpacity=".12" x="3" y="12" width="18" height="8" rx="1" />
    <rect stroke="currentColor" strokeWidth="1.5" x="3" y="12" width="18" height="8" rx="1" />
    <rect fill="currentColor" x="9.5" y="10" width="5" height="4" rx="1" />
    <path stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M10.5 10 V8.5 A1.5 1.5 0 0113.5 8.5 V10" />
    <line x1="3" y1="15" x2="21" y2="15" stroke="currentColor" strokeWidth="1" opacity=".25" />
  </svg>
);

// ── STATS ENGAGEMENT — eye → analyst ─────────────────────────────────────────

// T1: bar chart with eye
const ChartEye = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" fillOpacity=".45" x="2" y="15" width="4"  height="7" rx=".5" />
    <rect fill="currentColor" fillOpacity=".65" x="8" y="11" width="4"  height="11" rx=".5" />
    <rect fill="currentColor"                   x="14" y="8" width="4"  height="14" rx=".5" />
    <ellipse stroke="currentColor" strokeWidth="1.5" cx="20" cy="6" rx="3.5" ry="2.5" />
    <circle fill="currentColor" cx="20" cy="6" r="1.3" />
  </svg>
);

// T2: heartbeat / pulse line (data driven)
const ChartPulse = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <line x1="2" y1="14" x2="22" y2="14" stroke="currentColor" strokeWidth="1" opacity=".22" />
    <path stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      d="M2 14 L6 14 L8 6 L11 19 L13 11 L15 14 L22 14" />
  </svg>
);

// T3: area chart with analysis circle
const ChartAnalyst = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" fillOpacity=".18"
      d="M2 20 L6 16 L10 10 L14 13 L18 7 L22 9 L22 20 Z" />
    <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      d="M2 20 L6 16 L10 10 L14 13 L18 7 L22 9" />
    <circle stroke="currentColor" strokeWidth="1.5" cx="10" cy="10" r="3" />
    <path stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M12 7.5 L15 4" opacity=".5" />
    <path stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M15 4 L18 4 L18 7" opacity=".5" />
  </svg>
);

// ── EXPORTS — doc → press ─────────────────────────────────────────────────────

// T1: document with down-arrow (first export)
const ExportDoc = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" fillOpacity=".12" d="M5 3 H15 L19 7 V21 H5 Z" />
    <path stroke="currentColor" strokeWidth="1.5" d="M5 3 H15 L19 7 V21 H5 Z" />
    <path fill="currentColor" fillOpacity=".22" d="M15 3 L19 7 H15 Z" />
    <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M12 8 V15" />
    <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M9 13 L12 16 L15 13" />
  </svg>
);

// T2: stacked docs with arrow
const ExportStack = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" fillOpacity=".2" x="2" y="5" width="11" height="13" rx="1" />
    <rect fill="currentColor" fillOpacity=".4" x="5" y="3" width="11" height="13" rx="1" />
    <rect fill="currentColor" fillOpacity=".85" x="8" y="1" width="11" height="13" rx="1" />
    <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M19 14 V21" />
    <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M16.5 19 L19 22 L21.5 19" />
  </svg>
);

// T3: doc + upload arrow (batch)
const ExportBatch = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path fill="currentColor" fillOpacity=".12" d="M2 8 H12 L16 12 V22 H2 Z" />
    <path stroke="currentColor" strokeWidth="1.3" d="M2 8 H12 L16 12 V22 H2 Z" />
    <path stroke="currentColor" strokeWidth=".9" strokeLinecap="round" d="M5 13H13 M5 16H10" opacity=".4" />
    <rect stroke="currentColor" strokeWidth="1.3" fill="none" x="15" y="13" width="8" height="5" rx="1" opacity=".5" />
    <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M19 11 V5" />
    <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M17 7 L19 5 L21 7" />
  </svg>
);

// T4: printing press (100 exports)
const ExportMaster = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect fill="currentColor" fillOpacity=".12" x="2" y="10" width="20" height="7" rx="1.5" />
    <rect stroke="currentColor" strokeWidth="1.5" x="2" y="10" width="20" height="7" rx="1.5" />
    <rect fill="currentColor" x="3" y="11.5" width="18" height="4" rx="1" />
    {/* paper in */}
    <rect fill="currentColor" fillOpacity=".35" x="6" y="4" width="12" height="7" rx=".5" />
    <path stroke="currentColor" strokeWidth=".9" strokeLinecap="round" d="M9 6H15 M9 8.5H13" opacity=".5" />
    {/* paper out */}
    <rect fill="currentColor" fillOpacity=".35" x="6" y="17" width="12" height="5" rx=".5" />
    <path stroke="currentColor" strokeWidth=".9" strokeLinecap="round" d="M9 19H15 M9 21H12" opacity=".4" />
  </svg>
);

// ── CURRENCY ─────────────────────────────────────────────────────────────────

// T1: Single coin
const CoinSingle = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="12" r="7" fill="currentColor" fillOpacity=".18" stroke="currentColor" strokeWidth="1.4" />
    <line x1="9" y1="12" x2="15" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="12" y1="9.5" x2="12" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// T2: Stack of coins
const CoinStack = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <ellipse cx="12" cy="17" rx="6" ry="2.2" fill="currentColor" fillOpacity=".18" stroke="currentColor" strokeWidth="1.3" />
    <path d="M6 17V14" stroke="currentColor" strokeWidth="1.3" />
    <path d="M18 17V14" stroke="currentColor" strokeWidth="1.3" />
    <ellipse cx="12" cy="14" rx="6" ry="2.2" fill="currentColor" fillOpacity=".22" stroke="currentColor" strokeWidth="1.3" />
    <path d="M6 14V11" stroke="currentColor" strokeWidth="1.3" />
    <path d="M18 14V11" stroke="currentColor" strokeWidth="1.3" />
    <ellipse cx="12" cy="11" rx="6" ry="2.2" fill="currentColor" fillOpacity=".28" stroke="currentColor" strokeWidth="1.3" />
    <line x1="10" y1="11" x2="14" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

// T3: Vault door
const VaultDoor = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" fillOpacity=".35" />
    <line x1="12" y1="7.5" x2="12" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="16.5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="15.2" y1="8.8" x2="17" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <rect x="17" y="10" width="2.5" height="4" rx="1" fill="currentColor" fillOpacity=".5" />
  </svg>
);

// ── RELICS ────────────────────────────────────────────────────────────────────

// T1: Faceted gem / diamond
const RelicGem = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <polygon points="12,4 18,9 12,20 6,9" fill="currentColor" fillOpacity=".2" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <polygon points="12,4 18,9 12,13 6,9" fill="currentColor" fillOpacity=".35" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    <line x1="6" y1="9" x2="18" y2="9" stroke="currentColor" strokeWidth="1.1" />
    <line x1="12" y1="4" x2="12" y2="13" stroke="currentColor" strokeWidth=".8" strokeOpacity=".4" />
  </svg>
);

// T2: Amulet (gem on chain)
const RelicAmulet = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M8 5 Q12 3 16 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
    <line x1="8" y1="5" x2="9.5" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <line x1="16" y1="5" x2="14.5" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <polygon points="12,10 15,13 12,19 9,13" fill="currentColor" fillOpacity=".25" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <polygon points="12,10 15,13 12,15.5 9,13" fill="currentColor" fillOpacity=".45" strokeWidth="0" />
  </svg>
);

// T3: Ornate artifact (gem with rays)
const RelicArtifact = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
      const r = Math.PI * deg / 180;
      const x1 = 12 + Math.cos(r) * 5.5; const y1 = 12 + Math.sin(r) * 5.5;
      const x2 = 12 + Math.cos(r) * 7.8; const y2 = 12 + Math.sin(r) * 7.8;
      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeOpacity=".6" />;
    })}
    <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity=".18" stroke="currentColor" strokeWidth="1.3" />
    <polygon points="12,8.5 14,11.5 12,15.5 10,11.5" fill="currentColor" fillOpacity=".55" strokeWidth="0" />
    <polygon points="12,8.5 14,11.5 12,15.5 10,11.5" stroke="currentColor" strokeWidth=".8" strokeLinejoin="round" fillOpacity="0" />
  </svg>
);

// ── SPECIAL ──────────────────────────────────────────────────────────────────

// All Human: a quill pen — the pure human writer
const AllHuman = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path fill="currentColor" fillOpacity=".15" stroke="none" d="M19 3 C14 3 8 7 6 14 L10 18 C17 16 21 10 21 5 Z" />
    <path d="M19 3 C14 3 8 7 6 14 L10 18 C17 16 21 10 21 5 Z" />
    <line x1="6" y1="14" x2="3" y2="21" />
    <line x1="6" y1="14" x2="10" y2="18" />
    <line x1="12" y1="9" x2="16" y2="13" />
  </svg>
);

// All Achievements: a crown — the complete collection
const AllAchievements = ({ className }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path fill="currentColor" fillOpacity=".15" stroke="none" d="M3 19 L3 9 L7 14 L12 5 L17 14 L21 9 L21 19 Z" />
    <path d="M3 19 L3 9 L7 14 L12 5 L17 14 L21 9 L21 19 Z" />
    <line x1="3" y1="22" x2="21" y2="22" />
    <circle cx="12" cy="5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="3" cy="9" r="1" fill="currentColor" stroke="none" />
    <circle cx="21" cy="9" r="1" fill="currentColor" stroke="none" />
  </svg>
);

// ── ICON MAP ─────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, (p: P) => React.JSX.Element> = {
  // Streaks
  streak_1:   Spark,
  streak_3:   Spark,
  streak_7:   FlameS,
  streak_14:  FlameS,
  streak_30:  FlameM,
  streak_90:  FlameTall,
  streak_180: FlameTall,
  streak_365: FlameCrown,

  // Total words
  words_100:  Quill,
  words_1k:   Quill,
  words_5k:   QuillInk,
  words_10k:  QuillInk,
  words_20k:  BookOpenIcon,
  words_40k:  BookOpenIcon,
  words_80k:  BookStack,
  words_100k: BookStack,
  words_250k: TomeGlowing,
  words_500k: TomeGlowing,
  words_1m:   TomeGlowing,
  words_2m:   TomeNova,
  words_5m:   WordGalaxy,
  words_10m:  WordGalaxy,

  // Best single day
  day_500:  PenStroke,
  day_2k:   LightningBolt,
  day_5k:   RocketIcon,
  day_10k:  MeteorIcon,

  // Codex entries
  codex_1:   PageLeaf,
  codex_5:   PageLeaf,
  codex_15:  BookClosed,
  codex_30:  BookClosed,
  codex_75:  BookThick,
  codex_150: BookThick,
  codex_300: TomeLock,
  codex_500: TomeLock,
  codex_750: TomeStars,
  codex_1k:  TomeStars,

  // Codex relations
  rel_1:   TwoNodes,
  rel_10:  TriangleNet,
  rel_25:  StarNet,
  rel_50:  StarNet,
  rel_100: DenseNet,
  rel_250: CosmicNet,

  // Codex mentioned
  mentioned_1:   ShadowFigure,
  mentioned_10:  FigureOutline,
  mentioned_25:  TwoFigures,
  mentioned_50:  GroupFigures,
  mentioned_100: GroupFigures,
  mentioned_200: GlowingCast,

  // Projects
  project_1: FolderSingle,
  project_3: FolderDouble,
  project_5: Bookshelf,

  // Scenes
  scenes_10:  SceneCard,
  scenes_50:  SceneCards,
  scenes_100: SceneCards,
  scenes_250: SceneBoard,
  scenes_500: SceneInfinite,

  // Scene variety
  scene_types_5: Palette5Icon,

  // Publishing
  query_1:  Envelope,
  query_10: EnvelopeSent,
  query_25: EnvelopeStack,
  query_50: EnvelopeStack,
  partial:  EnvelopeSent,
  full_req: EnvelopeGold,
  offer:    TrophyCup,

  // Research
  research_1:  MagGlass,
  research_10: MagBook,
  research_25: ScholarGlass,
  research_50: Librarian,

  // Timeline
  timeline_1:   TimelineDot,
  timeline_10:  TimelineThree,
  timeline_50:  TimelineTracks,
  timeline_100: TimelineEpic,

  // Snippets / fragments
  snippet_1:  SnippetNote,
  snippet_10: SnippetStack,
  snippet_50: SnippetArchive,

  // Typed scenes
  typed_1:   TagSingle,
  typed_10:  TagDouble,
  typed_50:  TagFan,
  typed_100: TagMaster,

  // Corkboard (reuse scene board icons)
  corkboard_1:  SceneCard,
  corkboard_10: SceneCards,
  corkboard_50: SceneBoard,

  // Time system
  time_lord: TimeLordIcon,

  // Project info
  project_meta:      InfoDoc,
  project_meta_full: CompleteDoc,

  // Grammar
  grammar_active: GrammarCheck,

  // Pandoc
  pandoc_active: PandocConvert,

  // Inventory (possessions)
  inventory_1:  PouchIcon,
  inventory_10: BackpackIcon,
  inventory_50: ChestIcon,

  // Currency
  currency_1:  CoinSingle,
  currency_5:  CoinStack,
  currency_10: VaultDoor,

  // Relics
  relic_1:  RelicGem,
  relic_5:  RelicAmulet,
  relic_20: RelicArtifact,

  // Special
  all_human:        AllHuman,
  all_achievements: AllAchievements,

  // Hidden achievements
  pantser:       QuillInk,
  mirror:        TwoFigures,
  comeback_kid:  FlameM,
  perfect_month: FlameCrown,
  omnivore:      Palette5Icon,
  dense_prose:   BookThick,
  lore_bomb:     CosmicNet,
  the_planner:   SceneBoard,
  iceberg:       TomeStars,
  iceberg_100:   TomeLock,
  iceberg_200:   TomeNova,
  iceberg_500:   WordGalaxy,
  the_phantom:   ShadowFigure,
  double_feature:   FolderDouble,
  trilogy:          Bookshelf,
  quatrology:       BookStack,
  trilogy_in_five:  TomeNova,
  the_naturalist:   RelicArtifact,
  bibliophile:   Librarian,
  navel_gazer:   ChartAnalyst,

  // Stats engagement
  stats_view:    ChartEye,
  stats_addict:  ChartPulse,
  stats_analyst: ChartAnalyst,

  // Exports
  export_1:   ExportDoc,
  export_10:  ExportStack,
  export_50:  ExportBatch,
  export_100: ExportMaster,
};

// ── Export ────────────────────────────────────────────────────────────────────

interface AchievementIconProps {
  achievementKey: string;
  className?: string;
}

export function AchievementIcon({ achievementKey, className }: AchievementIconProps) {
  const Icon = ICON_MAP[achievementKey];
  if (!Icon) return null;
  return <Icon className={cn("w-8 h-8", className)} />;
}
