/**
 * Uploads 24 hours of simulator readings (1 per second, standard layout with voltage, metric) through the real
 * batch API from inside the signed-in page, into the throwaway recording database only. A 20-minute gap is left
 * on purpose so the History scene can show how an outage looks. Every value is synthetic.
 */
import type { Page } from "@playwright/test";

export async function seedSimulatedDay(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const session = await fetch("/api/session").then((r) => r.json());
    const settings = await fetch("/api/settings").then((r) => r.json());
    const profileId = settings.profile.id;
    const sum = (p: string) => { let x = 0; for (let i = 0; i < p.length; i++) x = (x + p.charCodeAt(i)) & 0xffff; return x; };
    const line = (p: string) => `${p}*${String(sum(p)).padStart(5, "0")}`;
    const pad = (v: number, i: number, d: number, sign = false) => {
      const t = Math.abs(v).toFixed(d).padStart(i + (d ? d + 1 : 0), "0");
      return sign ? (v < 0 ? "-" : "+") + t : t;
    };
    // Seeded pseudo-random so every recording looks the same.
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const N = 24 * 3600;
    const end = Date.now() - 1000;
    const gapFrom = N - 9 * 3600;
    const gapTo = gapFrom + 20 * 60;
    let ws = 3;
    let wd = 230;
    let accepted = 0;
    const session_id = crypto.randomUUID();
    let batch: { id: string; sequence: number; observedAt: string; raw: string }[] = [];
    const flush = async () => {
      if (!batch.length) return;
      const res = await fetch("/api/observations/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
        body: JSON.stringify({ captureSessionId: session_id, profileId, records: batch }),
      }).then((r) => r.json());
      accepted += res.accepted.length;
      batch = [];
    };
    for (let i = 0; i < N; i++) {
      const t = end - (N - 1 - i) * 1000;
      if (i >= gapFrom && i < gapTo) continue;
      const hour = new Date(t).getHours() + new Date(t).getMinutes() / 60;
      const day = Math.sin(((hour - 9) / 24) * 2 * Math.PI); // warmest mid-afternoon
      const target = 3.5 + 2.5 * Math.max(0, day);
      ws = Math.max(0, ws + (target - ws) * 0.01 + (rnd() - 0.5) * 0.9);
      wd = (wd + (rnd() - 0.5) * 14 + (245 - wd) * 0.002 + 360) % 360;
      const gust = rnd() < 0.01 ? rnd() * 5 : 0;
      const at = 15 + 6 * day + (rnd() - 0.5) * 0.1;
      const rh = 60 - 18 * day + (rnd() - 0.5);
      const bp = 1013 - (i / N) * 3 + Math.sin(i / 5000) * 0.3;
      const payload = [pad(Math.min(60, ws + gust), 3, 1), pad(Math.round(wd) % 360, 3, 0), pad(at, 3, 1, true), pad(Math.round(rh), 3, 0),
        pad(bp, 4, 1), "000.00", "0000", pad(12.5 + (rnd() - 0.5) * 0.1, 2, 1), "M0"].join(",") + ",";
      batch.push({ id: crypto.randomUUID(), sequence: i, observedAt: new Date(t).toISOString(), raw: line(payload) });
      if (batch.length === 100) await flush();
    }
    await flush();
    return accepted;
  });
}
