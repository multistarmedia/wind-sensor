/**
 * What the recorder does on screen in each live scene (the outline's `steps`). Runs against the throwaway
 * recording server only, so the setup wizard really saves into a database that is deleted afterwards.
 */
import fs from "node:fs";
import path from "node:path";
import type { SceneAction } from "../scenes";
import { glideTo, labelSimulated, pointAt, spotlight, spotlightOff, zoomOut, zoomTo } from "../camera";
import { seedSimulatedDay } from "../seed";

const PASSWORD = process.env.VIDEO_PASSWORD ?? "";
const SHOTS = path.resolve("video/out/shots");

const nav = (label: string) => `.topbar nav a:has-text("${label}")`;

export const ACTIONS: Record<string, { url?: string; action: SceneAction }> = {
  "s02-signin": {
    url: "/",
    action: async ({ page, pause }) => {
      await pause(900);
      await pointAt(page, 'input[type="password"]');
      await page.locator('input[type="password"]').click();
      await page.locator('input[type="password"]').pressSequentially(PASSWORD.slice(0, 24), { delay: 55 });
      await pause(400);
      await pointAt(page, 'button:has-text("Sign in")');
      await page.locator('button:has-text("Sign in")').click();
    },
  },
  "s03-station": {
    action: async ({ page, pause }) => {
      const name = page.getByPlaceholder("e.g. Ridge top");
      await name.waitFor();
      await pointAt(page, 'input[placeholder="e.g. Ridge top"]');
      await name.click();
      await name.pressSequentially("Home station", { delay: 70 });
      await pause(500);
      await spotlight(page, "select");
      await pause(2600);
      await spotlightOff(page);
      await pointAt(page, 'button:has-text("Next: instrument output")');
      await page.locator('button:has-text("Next: instrument output")').click();
    },
  },
  "s04-output": {
    action: async ({ page, pause }) => {
      await pause(800);
      await spotlight(page, ".Polaris-Box:has(code)");
      await pause(2200);
      await spotlightOff(page);
      const box = page.getByLabel("I checked the instrument’s actual output settings and they match the choices above");
      await glideTo(page, 'button:has-text("Save and connect")', "center");
      await box.check({ force: true });
      await pause(900);
      await pointAt(page, 'button:has-text("Save and connect")');
      await pause(400);
      await page.locator('button:has-text("Save and connect")').click();
    },
  },
  "s05-connection": {
    action: async ({ page, pause }) => {
      await page.getByText("Connection & diagnostics").waitFor();
      await pause(1200);
      await zoomTo(page, ".Polaris-DataTable", { fill: 0.6 });
      await pause(5200);
      await zoomOut(page);
    },
  },
  "s06-connect": {
    action: async ({ page, pause }) => {
      await spotlight(page, 'button:has-text("Connect instrument")', { pad: 16 });
      await pointAt(page, 'button:has-text("Connect instrument")');
      await pause(5000);
      await spotlightOff(page);
    },
  },
  "s08-demo": {
    url: "/#/connection",
    action: async ({ page, pause }) => {
      await pause(700);
      await pointAt(page, 'button:has-text("Start demo (simulated)")');
      await page.locator('button:has-text("Start demo (simulated)")').click();
      await pause(900);
      await spotlight(page, ".demo-ribbon", { pad: 4 });
      await pause(2600);
      await spotlightOff(page);
      await page.locator(nav("Live")).click();
    },
  },
  "s09-dial": {
    action: async ({ page, pause, skip }) => {
      // Let the simulator build up a minute of readings so the rose and trail have something to show.
      await skip(() => page.waitForTimeout(60_000));
      await zoomTo(page, ".wind-dial", { fill: 0.85 });
      await pause(9000);
    },
  },
  "s10-rose": {
    action: async ({ page, pause }) => {
      await zoomOut(page);
      await zoomTo(page, ".rose-petals", { fill: 0.6 });
      await pause(4500);
      await zoomOut(page);
      await zoomTo(page, ".force-legend", { scale: 2.2 });
      await pause(3500);
    },
  },
  "s11-detail": {
    action: async ({ page, pause }) => {
      await zoomOut(page);
      await spotlight(page, ".wind-stats");
      await pause(4000);
      await spotlightOff(page);
    },
  },
  "s12-cards": {
    action: async ({ page, pause }) => {
      await glideTo(page, ".dash-grid > .stat-card:last-of-type", "end");
      await spotlight(page, ".dash-grid > .stat-card >> nth=0");
      await pause(2200);
      await spotlight(page, ".dash-grid > .stat-card >> nth=1");
      await pause(1800);
      await spotlight(page, ".dash-grid > .stat-card >> nth=2");
      await pause(2200);
      await spotlightOff(page);
    },
  },
  "s13-status": {
    action: async ({ page, pause }) => {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
      await pause(800);
      // The strip is full width with its pills on the left; shrink it to the pills so the zoom lands on them.
      await page.addStyleTag({ content: ".status-strip{width:fit-content;border-radius:0 0 12px 0}" });
      await zoomTo(page, ".status-strip", { scale: 2.4 });
      await pause(6000);
      await zoomOut(page);
    },
  },
  "s14-history": {
    action: async ({ page, pause, skip }) => {
      await skip(async () => {
        await page.locator('button:has-text("Exit demo")').click();
        const n = await seedSimulatedDay(page);
        console.log(`  seeded ${n} simulated readings`);
        // Phone capture for s17: a second, phone-sized browser on the same account, like a viewer.
        const ctx = await page.context().browser()!.newContext({
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
          storageState: await page.context().storageState(),
        });
        const phone = await ctx.newPage();
        await phone.goto(page.url().replace(/#.*$/, "#/dashboard"));
        await phone.locator(".wind-dial").waitFor();
        await phone.waitForTimeout(6000);
        await labelSimulated(phone);
        await phone.evaluate(() => {
          const el = document.getElementById("video-simulated");
          if (el) Object.assign(el.style, { top: "auto", bottom: "16px", right: "12px", fontSize: "12px" });
        });
        fs.mkdirSync(SHOTS, { recursive: true });
        await phone.screenshot({ path: path.join(SHOTS, "phone.png") });
        await ctx.close();
        await page.locator(nav("History")).click();
        await page.locator(".recharts-surface").first().waitFor();
        await page.waitForTimeout(1500);
      });
      await labelSimulated(page);
      await pause(3500);
      await glideTo(page, ".history-grid .chart-panel >> nth=2", "center");
      await pause(3500);
      await glideTo(page, ".rose-panel", "center");
      await pause(2500);
    },
  },
  "s15-log": {
    action: async ({ page, pause }) => {
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await page.locator(nav("Log")).click();
      await page.locator(".log-table tbody tr").first().waitFor();
      await pause(700);
      // Spotlight rather than zoom, so the simulated-readings label stays on screen.
      await spotlight(page, ".log-table-wrap", { pad: 6 });
      await pause(4200);
      await spotlightOff(page);
    },
  },
  "s16-export": {
    action: async ({ page, pause }) => {
      await spotlight(page, ".export-panel");
      await pointAt(page, '.export-panel a:has-text("Download"), .export-panel button:has-text("Download")');
      await pause(4000);
      await spotlightOff(page);
    },
  },
};
