/**
 * Voices each scene with ElevenLabs (cached per voice + model + text) and writes durations-<set>.json.
 * Needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env. FORCE=1 re-voices everything.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { NARR_DIR, SCENES, SET } from "./scenes";

if (fs.existsSync(".env")) process.loadEnvFile(".env");
const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "";
const MODEL_ID = process.env.ELEVENLABS_MODEL || "eleven_v4";
const SETTINGS = {
  stability: Number(process.env.ELEVENLABS_STABILITY ?? 0.72),
  similarity_boost: 0.8,
  style: Number(process.env.ELEVENLABS_STYLE ?? 0),
  use_speaker_boost: true,
  speed: Number(process.env.ELEVENLABS_SPEED ?? 1),
};
const clean = (t: string) => t.replace(/\s+/g, " ").trim();
const probe = (p: string) => parseFloat(execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${p}"`).toString().trim());

async function speak(text: string, out: string, previous?: string, next?: string) {
  if (!API_KEY || !VOICE_ID) throw new Error("Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { Accept: "audio/mpeg", "Content-Type": "application/json", "xi-api-key": API_KEY },
    body: JSON.stringify({
      text: clean(text), model_id: MODEL_ID, voice_settings: SETTINGS, seed: 7,
      ...(previous ? { previous_text: clean(previous) } : {}),
      ...(next ? { next_text: clean(next) } : {}),
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}

fs.mkdirSync(NARR_DIR, { recursive: true });
const durations: Record<string, { audio: number; gap: number }> = {};
let total = 0;
for (const [i, s] of SCENES.entries()) {
  const mp3 = path.join(NARR_DIR, `${s.id}-${SET}.mp3`);
  const stamp = `${VOICE_ID} ${MODEL_ID} ${JSON.stringify(SETTINGS)}\n${clean(s.text)}`;
  const fresh = fs.existsSync(mp3) && fs.existsSync(`${mp3}.txt`) && fs.readFileSync(`${mp3}.txt`, "utf8") === stamp;
  if (fresh && process.env.FORCE !== "1") console.log(`⏭  ${s.id} unchanged`);
  else {
    console.log(`🔊 ${s.id}`);
    await speak(s.text, mp3, SCENES[i - 1]?.text, SCENES[i + 1]?.text);
    fs.writeFileSync(`${mp3}.txt`, stamp);
  }
  durations[s.id] = { audio: probe(mp3), gap: s.silenceAfter };
  total += durations[s.id]!.audio + s.silenceAfter;
}
fs.writeFileSync(path.join(NARR_DIR, `durations-${SET}.json`), JSON.stringify(durations, null, 2));
console.log(`✅ ${SCENES.length} lines, scripted runtime ${total.toFixed(1)}s`);
