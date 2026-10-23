/**
 * Scene list for the narrated-video pipeline: outline + words (+ recorder actions for live scenes).
 * Pick a video with VIDEO=<id> (default getting-started) and LANG=<lang> (default en).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "@playwright/test";
import type { SceneScript, VideoOutline } from "./types";
import { OUTLINE as gettingStarted } from "./getting-started/outline";
import { ACTIONS as gettingStartedActions } from "./getting-started/actions";

export interface SceneAction {
  (ctx: {
    page: Page;
    /** Pause (counts against the scene's time). */
    pause: (ms: number) => Promise<void>;
    /** Run a slow step and cut it out of the video (the scene's clock stops while it runs). */
    skip: (run: () => Promise<void>) => Promise<void>;
  }): Promise<void>;
}

export interface Scene {
  id: string;
  text: string;
  /** Caption when it differs from the spoken text */
  caption: string;
  silenceAfter: number;
  card?: { template: string; props: Record<string, unknown> };
  /** App route to load at the start of the scene (load time is cut) */
  url?: string;
  action?: SceneAction;
}

const VIDEOS: Record<string, { outline: VideoOutline; actions: Record<string, { url?: string; action: SceneAction }> }> = {
  "getting-started": { outline: gettingStarted, actions: gettingStartedActions },
};

export const VIDEO = process.env.VIDEO || "getting-started";
export const LANG = process.env.LANG_CODE || "en";
export const SET = LANG === "en" ? VIDEO : `${VIDEO}.${LANG}`;

const VIDEO_DIR = path.resolve(process.cwd(), "video");

function load(): Scene[] {
  const v = VIDEOS[VIDEO];
  if (!v) throw new Error(`Unknown VIDEO "${VIDEO}". Known: ${Object.keys(VIDEOS).join(", ")}`);
  const file = path.join(VIDEO_DIR, VIDEO, `${LANG}.json`);
  const words: Record<string, SceneScript> = JSON.parse(fs.readFileSync(file, "utf8"));
  return v.outline.scenes.map((s) => {
    const w = words[s.id];
    if (!w) throw new Error(`${file} has no scene ${s.id}`);
    const live = v.actions[s.id];
    if (s.kind === "live" && !live) throw new Error(`No recorder action for live scene ${s.id}`);
    return {
      id: s.id,
      text: w.text,
      caption: w.caption ?? w.text,
      silenceAfter: s.silenceAfter,
      ...(s.kind === "card"
        // Explicit defaults so a template's own preview defaults never leak into the video.
        ? { card: { template: s.template!, props: { kicker: "", chips: [], url: "", fine: "", label: "", moves: [], ...s.props, ...w.card } } }
        : { url: live!.url, action: live!.action }),
    };
  });
}

export const SCENES: Scene[] = load();

export function cardUrl(card: NonNullable<Scene["card"]>, extra: Record<string, unknown>) {
  const file = path.join(VIDEO_DIR, "cards", card.template);
  return `${pathToFileURL(file).href}?t=${Date.now()}#${encodeURIComponent(JSON.stringify({ ...card.props, ...extra }))}`;
}

export const OUT_DIR = path.join(VIDEO_DIR, "out");
export const NARR_DIR = path.join(OUT_DIR, "narration");
