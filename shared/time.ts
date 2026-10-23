// Station-time helpers built on Intl, so DST follows the IANA database.

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

function zonedParts(tz: string, ms: number) {
  const p: Record<string, number> = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (type !== 'literal') p[type] = Number(value);
  }
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! };
}

/** Offset (local − UTC) in ms for the zone at the given instant. */
export function zoneOffsetMs(tz: string, ms: number): number {
  const z = zonedParts(tz, ms);
  const asUtc = Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant of local midnight starting the station-calendar day that contains `ms`. */
export function startOfZonedDay(tz: string, ms: number): number {
  const z = zonedParts(tz, ms);
  const localMidnight = Date.UTC(z.y, z.mo - 1, z.d);
  let t = localMidnight - zoneOffsetMs(tz, localMidnight);
  t = localMidnight - zoneOffsetMs(tz, t);
  // Zones whose DST jump skips midnight: the day starts at the first instant that is on this date.
  const zt = zonedParts(tz, t);
  if (zt.d !== z.d) {
    while (zonedParts(tz, t).d !== z.d) t += 15 * 60_000;
  }
  return t;
}

export function formatStationTime(ms: number, tz: string, opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }) {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }).format(new Date(ms));
}
