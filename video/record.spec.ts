/**
 * Synced recorder: holds each scene on screen for exactly its narration + silenceAfter (from
 * durations-<set>.json), then writes scene starts and cut stretches for the merge and caption steps.
 * Output: test-results/video/<test>/video.webm
 */
import fs from "node:fs";
import path from "node:path";
import { test, type Page } from "@playwright/test";
import { cardUrl, NARR_DIR, SCENES, SET } from "./scenes";

const BASE = process.env.VIDEO_BASE_URL ?? "http://localhost:3300";

function timer(page: Page, totalSec: number) {
  let start = Date.now();
  return {
    pause: (ms: number) => page.waitForTimeout(ms),
    extend: (ms: number) => { start += ms; },
    reset: () => { start = Date.now(); },
    finish: async () => {
      const left = totalSec * 1000 - (Date.now() - start);
      if (left > 150) await page.waitForTimeout(left);
      else if (left < -500) console.warn(`  ⚠ scene ran ${(-left / 1000).toFixed(1)}s over its line`);
    },
  };
}

test("narrated video", async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);
  const durations: Record<string, { audio: number; gap: number }> = JSON.parse(
    fs.readFileSync(path.join(NARR_DIR, `durations-${SET}.json`), "utf8"),
  );
  page.on("dialog", (d) => d.accept().catch(() => {}));

  const t0 = Date.now();
  const starts: Record<string, number> = {};
  const cuts: [number, number][] = [];
  let cutSoFar = 0;
  const now = () => (Date.now() - t0) / 1000 - cutSoFar;
  const cutFrom = (from: number) => {
    const ms = Date.now() - from;
    cuts.push([(from - t0) / 1000, (Date.now() - t0) / 1000]);
    cutSoFar += ms / 1000;
    return ms;
  };

  for (const scene of SCENES) {
    const d = durations[scene.id];
    if (!d) throw new Error(`No narration duration for ${scene.id}: run the narration step`);
    const total = d.audio + d.gap;
    console.log(`▶ ${scene.id}: ${total.toFixed(1)}s`);
    const t = timer(page, total);

    if (scene.card) {
      const from = Date.now();
      await page.goto(cardUrl(scene.card, { duration: total }));
      cutFrom(from); // the card's own entrance starts once it is on screen
      starts[scene.id] = now();
      t.reset();
      await t.finish();
      continue;
    }

    if (scene.url) {
      const from = Date.now();
      await page.goto(BASE + scene.url);
      await page.locator("#root *").first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(800);
      cutFrom(from);
      t.reset();
    }
    starts[scene.id] = now();
    const skip = async (run: () => Promise<void>) => {
      const from = Date.now();
      await run().catch((e) => console.warn(`  (skipped step in ${scene.id} threw) ${e instanceof Error ? e.message : e}`));
      t.extend(cutFrom(from));
      console.log(`  ✂ cut ${((Date.now() - from) / 1000).toFixed(1)}s`);
    };
    try {
      await scene.action!({ page, pause: (ms) => page.waitForTimeout(ms), skip });
    } catch (e) {
      console.warn(`  (action in ${scene.id} threw, continuing) ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
    await t.finish();
  }

  fs.writeFileSync(path.join(NARR_DIR, `scene-starts-${SET}.json`), JSON.stringify(starts, null, 2));
  fs.writeFileSync(path.join(NARR_DIR, `cuts-${SET}.json`), JSON.stringify(cuts, null, 2));
  console.log(`🕐 wrote scene starts and ${cuts.length} cuts`);
});
