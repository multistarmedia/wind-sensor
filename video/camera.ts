/**
 * Camera helpers for recordings of the console (a top-level page, no iframes). Ported from the Intelli404
 * training pipeline. None of them throw: a missed selector must never kill a recording.
 */
import type { Page } from "@playwright/test";

const ACCENT = "56,189,248"; // sky #38bdf8

async function box(page: Page, selector: string) {
  const el = page.locator(selector).first();
  const r = await el.boundingBox().catch(() => null);
  if (!r || !r.width || !r.height) return null;
  return r;
}

/** Whole-page zoom toward an element (it takes `fill` of the screen, 1.4×–3×). zoomOut() before scrolling. */
export async function zoomTo(page: Page, selector: string, opts: { scale?: number; fill?: number; ms?: number } = {}) {
  try {
    await page.locator(selector).first().scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
    const r = await box(page, selector);
    if (!r) return;
    await page.evaluate(
      ({ r, scale, fill, ms }) => {
        const root = document.documentElement;
        const W = window.innerWidth;
        const H = window.innerHeight;
        const cur = getComputedStyle(root).transform;
        const m = new DOMMatrixReadOnly(cur === "none" ? undefined : cur);
        const x = (r.x - m.e) / m.a;
        const y = (r.y - m.f) / m.d;
        const w = r.width / m.a;
        const h = r.height / m.d;
        const s = scale ?? Math.max(1.4, Math.min(3, Math.min((W * fill) / w, (H * fill) / h)));
        const tx = Math.min(0, Math.max(W - W * s, W / 2 - (x + w / 2) * s));
        const ty = Math.min(0, Math.max(H - H * s, H / 2 - (y + h / 2) * s));
        document.body.style.overflow = "hidden";
        root.style.transformOrigin = "0 0";
        root.style.transition = `transform ${ms}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        root.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      },
      { r, scale: opts.scale, fill: opts.fill ?? 0.7, ms: opts.ms ?? 900 },
    );
    await page.waitForTimeout((opts.ms ?? 900) + 100);
  } catch (e) {
    console.warn(`  (camera: zoom missed) ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }
}

export async function zoomOut(page: Page, ms = 800) {
  try {
    await page.evaluate((ms) => {
      const root = document.documentElement;
      if (!root.style.transform) return;
      root.style.transition = `transform ${ms}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      root.style.transform = "translate(0px, 0px) scale(1)";
      // Clear the transform entirely afterwards: even scale(1) would make position:fixed overlays scroll with the page.
      setTimeout(() => { root.style.transform = ""; root.style.transition = ""; document.body.style.overflow = ""; }, ms);
    }, ms);
    await page.waitForTimeout(ms + 100);
  } catch {
    /* keep rolling */
  }
}

/** Dims everything except the element, with a soft accent ring. Moves with zoomTo(). */
export async function spotlight(page: Page, selector: string, opts: { pad?: number } = {}) {
  try {
    await page.locator(selector).first().scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
    const r = await box(page, selector);
    if (!r) return;
    await page.evaluate(
      ({ r, pad, accent }) => {
        const root = document.documentElement;
        const cur = getComputedStyle(root).transform;
        const t = new DOMMatrixReadOnly(cur === "none" ? undefined : cur);
        const x = (r.x - t.e) / t.a;
        const y = (r.y - t.f) / t.d;
        document.getElementById("video-spotlight")?.remove();
        const spot = document.createElement("div");
        spot.id = "video-spotlight";
        Object.assign(spot.style, {
          position: "absolute",
          left: `${x - pad + window.scrollX}px`,
          top: `${y - pad + window.scrollY}px`,
          width: `${r.width / t.a + pad * 2}px`,
          height: `${r.height / t.d + pad * 2}px`,
          borderRadius: "16px",
          boxShadow: `0 0 0 3px rgba(${accent},.9), 0 0 28px 8px rgba(${accent},.35), 0 0 0 200vmax rgba(2,5,12,.62)`,
          pointerEvents: "none",
          zIndex: "2147483646",
          opacity: "0",
          transition: "opacity 450ms ease",
        });
        document.body.appendChild(spot);
        requestAnimationFrame(() => (spot.style.opacity = "1"));
      },
      { r, pad: opts.pad ?? 12, accent: ACCENT },
    );
    await page.waitForTimeout(500);
  } catch (e) {
    console.warn(`  (camera: spotlight missed) ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }
}

export async function spotlightOff(page: Page) {
  try {
    await page.evaluate(() => {
      const spot = document.getElementById("video-spotlight");
      if (!spot) return;
      spot.style.opacity = "0";
      setTimeout(() => spot.remove(), 500);
    });
    await page.waitForTimeout(450);
  } catch {
    /* keep rolling */
  }
}

/** Smoothly scrolls an element into view. */
export async function glideTo(page: Page, selector: string, block: "start" | "center" | "end" = "center") {
  try {
    await page.locator(selector).first().evaluate((n, b) => n.scrollIntoView({ block: b, behavior: "smooth" }), block);
    await page.waitForTimeout(900);
  } catch {
    /* keep rolling */
  }
}

/** Moves the mouse in visible steps to an element's centre (so a viewer sees what's being pointed at). */
export async function pointAt(page: Page, selector: string) {
  const r = await box(page, selector);
  if (r) await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 18 });
}

/**
 * A persistent on-screen label for scenes that show seeded simulator readings, so nobody mistakes them
 * for a real station's data.
 */
export async function labelSimulated(page: Page) {
  await page.evaluate(() => {
    if (document.getElementById("video-simulated")) return;
    const el = document.createElement("div");
    el.id = "video-simulated";
    el.textContent = "SIMULATED READINGS · recorded for this video";
    Object.assign(el.style, {
      position: "fixed", top: "118px", right: "28px", zIndex: "2147483647", padding: "10px 18px", borderRadius: "999px",
      background: "repeating-linear-gradient(45deg,#a16207,#a16207 12px,#854d0e 12px,#854d0e 24px)", color: "#fff7ed",
      font: "800 16px/1 -apple-system,Helvetica,Arial,sans-serif", letterSpacing: ".04em", boxShadow: "0 6px 20px rgba(0,0,0,.4)",
    });
    document.body.appendChild(el);
  }).catch(() => {});
}
