/**
 * Getting started (~2.5 min) for the AIO 2 Weather Console. Words: en.json. Live scenes are driven by Playwright
 * against a throwaway local server (video/make.mjs); their steps are implemented in actions.ts.
 * Dashboard scenes use the app's labelled demo mode. History, log and phone scenes use simulator readings seeded
 * into the throwaway database, with a "Simulated readings" label on screen.
 */
import type { VideoOutline } from "../types";

export const OUTLINE: VideoOutline = {
  id: "getting-started",
  scenes: [
    { id: "s00-title", kind: "card", template: "title-card.html", silenceAfter: 0.6 },
    { id: "s01-how", kind: "card", template: "title-card.html", silenceAfter: 0.6 },
    { id: "s02-signin", kind: "live", silenceAfter: 0.6, steps: ["Open the site", "Type the station password", "Sign in"] },
    { id: "s03-station", kind: "live", silenceAfter: 0.6, steps: ["Type a station name", "Point at the time zone", "Next"] },
    { id: "s04-output", kind: "live", silenceAfter: 0.6, steps: ["Point at the expected field order", "Tick the confirmation box", "Save and connect"] },
    { id: "s05-connection", kind: "live", silenceAfter: 0.6, steps: ["Connection page", "Zoom on the fixed port settings"] },
    { id: "s06-connect", kind: "live", silenceAfter: 0.6, steps: ["Spotlight Connect instrument (not clicked: the port chooser is the browser's own)"] },
    { id: "s07-port", kind: "card", template: "title-card.html", silenceAfter: 0.6 },
    { id: "s08-demo", kind: "live", silenceAfter: 0.6, steps: ["Start demo", "Point at the demo ribbon", "Open Live"] },
    { id: "s09-dial", kind: "live", silenceAfter: 0.6, steps: ["Let demo readings build (cut)", "Zoom on the dial"] },
    { id: "s10-rose", kind: "live", silenceAfter: 0.6, steps: ["Zoom on the colour legend"] },
    { id: "s11-detail", kind: "live", silenceAfter: 0.6, steps: ["Spotlight the wind detail panel"] },
    { id: "s12-cards", kind: "live", silenceAfter: 0.6, steps: ["Glide to temperature, humidity and pressure"] },
    { id: "s13-status", kind: "live", silenceAfter: 0.6, steps: ["Zoom on the status strip"] },
    { id: "s14-history", kind: "live", silenceAfter: 0.6, steps: ["Exit demo, seed simulated readings, phone capture (cut)", "Open History, 24 h", "Glide down the charts"] },
    { id: "s15-log", kind: "live", silenceAfter: 0.6, steps: ["Open Log", "Spotlight the newest rows"] },
    { id: "s16-export", kind: "live", silenceAfter: 0.6, steps: ["Spotlight the CSV download"] },
    { id: "s17-phone", kind: "card", template: "screen-card.html", props: { image: "../out/shots/phone.png", moves: [] }, silenceAfter: 0.6 },
    { id: "s18-outro", kind: "card", template: "title-card.html", props: { dark: true }, silenceAfter: 1.6 },
  ],
};
