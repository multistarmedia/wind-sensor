// Builds a narrated video end to end:
//   build the app → start a throwaway server (fresh database, random password) → voice the lines →
//   record with Playwright → stop the server and delete its database → merge audio → burn captions.
//
//   node video/make.mjs                 (VIDEO=getting-started LANG_CODE=en by default)
//   SKIP_BUILD=1 node video/make.mjs    reuse the current dist/
// Output: video/out/<set>-subtitled.mp4
import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PORT = 3300;
const DATA = path.resolve("video/.data");
const env = { ...process.env, VIDEO: process.env.VIDEO ?? "getting-started", LANG_CODE: process.env.LANG_CODE ?? "en" };
const run = (cmd, extra = {}) => execSync(cmd, { stdio: "inherit", env: { ...env, ...extra } });

if (!process.env.SKIP_BUILD) run("npm run build");
run("npx tsx video/narration.ts");

fs.rmSync(DATA, { recursive: true, force: true });
fs.rmSync("test-results/video", { recursive: true, force: true });
const password = crypto.randomBytes(12).toString("base64url");
const server = spawn("node", [path.resolve("dist/server/index.mjs")], {
  stdio: ["ignore", "inherit", "inherit"],
  env: {
    ...env,
    // Throwaway credentials and database: nothing here touches the real station.
    PUBLIC_ORIGIN: `http://localhost:${PORT}`,
    HOST: "127.0.0.1",
    PORT: String(PORT),
    OWNER_PASSWORD: password,
    OWNER_PASSWORD_HASH: "",
    SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
    DATA_DIR: DATA,
    CLIENT_DIR: path.resolve("dist/client"),
  },
  cwd: path.resolve("video"), // so the app's .env loader doesn't pick up the repo's .env
});
try {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/healthz`);
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  run("npx playwright test -c video/playwright.config.ts", { VIDEO_BASE_URL: `http://localhost:${PORT}`, VIDEO_PASSWORD: password });
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 800));
  fs.rmSync(DATA, { recursive: true, force: true });
}
run("npx tsx video/merge.ts");
