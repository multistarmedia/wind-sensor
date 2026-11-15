// Semi-circular station-pressure dial adapted from the BARO web companion (no weather labels).
// Scale marks put 1013 at the top centre; the needle uses the same piecewise map so it agrees
// with the readout (a linear 930–1070 map wrongly put 1013 ~22° past vertical).

const MIN_HPA = 930;
const MAX_HPA = 1070;
const SEA_LEVEL_HPA = 1013;

/** Labeled ticks: angles are degrees from vertical-up (needle transform). */
const TICKS: { hpa: number; deg: number }[] = [
  { hpa: MIN_HPA, deg: -120 },
  { hpa: 970, deg: -60 },
  { hpa: SEA_LEVEL_HPA, deg: 0 },
  { hpa: 1050, deg: 60 },
  { hpa: MAX_HPA, deg: 120 },
];

/** Map station pressure to needle angle; piecewise-linear through the labeled ticks. */
export function angleFor(hpa: number): number {
  const v = Math.min(MAX_HPA, Math.max(MIN_HPA, hpa));
  for (let i = 0; i < TICKS.length - 1; i++) {
    const a = TICKS[i]!;
    const b = TICKS[i + 1]!;
    if (v <= b.hpa) {
      const t = (v - a.hpa) / (b.hpa - a.hpa);
      return a.deg + t * (b.deg - a.deg);
    }
  }
  return TICKS[TICKS.length - 1]!.deg;
}

export function PressureDial({
  hpa,
  label,
  scaleUnit = 'hPa',
}: {
  hpa: number | null;
  label: string;
  /** Arc is calibrated in hPa (= mbar); label follows the selected identical-magnitude unit. */
  scaleUnit?: 'hPa' | 'mbar';
}) {
  const deg = hpa == null ? -120 : angleFor(hpa);

  return (
    <div className="pressure-dial">
      <svg className="pressure-dial-svg" viewBox="0 0 320 220" aria-hidden="true">
        <path d="M 47 185 A 130 130 0 0 1 273 185" fill="none" stroke="#161B22" strokeWidth="18" />
        {/* Colour bands — heat-map radar palette (cool → hot), no weather-condition labels (SPEC). */}
        <path d="M 47 185 A 130 130 0 0 1 101 80" fill="none" stroke="#00B7FF" strokeWidth="7" />
        <path d="M 101 80 A 130 130 0 0 1 160 55" fill="none" stroke="#00E676" strokeWidth="7" />
        <path d="M 160 55 A 130 130 0 0 1 219 80" fill="none" stroke="#FFD600" strokeWidth="7" />
        <path d="M 219 80 A 130 130 0 0 1 273 185" fill="none" stroke="#FF1744" strokeWidth="7" />
        {/* Labels stay above the arc; needle angle map puts 1013 at top centre. */}
        <text x="22" y="200" fill="#94A3B8" fontSize="13" fontWeight="500">930</text>
        <text x="58" y="88" fill="#94A3B8" fontSize="13" fontWeight="500" textAnchor="middle">970</text>
        <text x="160" y="28" fill="#C4A35A" fontSize="14" fontWeight="700" textAnchor="middle">1013</text>
        <text x="262" y="88" fill="#94A3B8" fontSize="13" fontWeight="500" textAnchor="middle">1050</text>
        <text x="298" y="200" fill="#94A3B8" fontSize="13" fontWeight="500" textAnchor="end">1070</text>
        <text x="160" y="214" fill="#64748B" fontSize="11" fontWeight="500" textAnchor="middle">{scaleUnit}</text>
        <g style={{ transformOrigin: '160px 185px', transform: `rotate(${deg}deg)`, transition: 'transform 0.4s cubic-bezier(0.1, 1, 0.2, 1)' }}>
          <line x1="160" y1="185" x2="160" y2="70" stroke="#F8FAFC" strokeWidth="2.8" strokeLinecap="round" />
        </g>
        <circle cx="160" cy="185" r="10" fill="#161B22" stroke="#F8FAFC" strokeWidth="2" />
        <circle cx="160" cy="185" r="3" fill="#FFD600" />
      </svg>
      <div className="pressure-dial-readout">
        <b>{label}</b>
        {/* Keep the old caption’s line box so the history chart does not creep up. */}
        <span className="pressure-dial-spacer" aria-hidden="true">&nbsp;</span>
      </div>
    </div>
  );
}
