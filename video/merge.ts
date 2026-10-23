/**
 * Newest recording + narration → video/out/<set>.mp4, then captions burned in → <set>-subtitled.mp4.
 * Cut stretches are removed first; each line is laid at its scene's recorded start so nothing drifts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { NARR_DIR, OUT_DIR, SCENES, SET } from "./scenes";

const sh = (cmd: string) => execSync(cmd, { stdio: "inherit" });
const probe = (p: string) => parseFloat(execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${p}"`).toString().trim());
const work = fs.mkdtempSync(path.join(os.tmpdir(), "aio2-video-"));

function newestWebm(dir: string): string {
  let best = { p: "", t: 0 };
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".webm") && fs.statSync(p).mtimeMs > best.t) best = { p, t: fs.statSync(p).mtimeMs };
    }
  };
  walk(dir);
  if (!best.p) throw new Error(`No recording under ${dir}`);
  return best.p;
}

const recording = newestWebm(path.resolve("test-results/video"));
const starts: Record<string, number> = JSON.parse(fs.readFileSync(path.join(NARR_DIR, `scene-starts-${SET}.json`), "utf8"));
const cuts: [number, number][] = JSON.parse(fs.readFileSync(path.join(NARR_DIR, `cuts-${SET}.json`), "utf8"));

// Constant 25 fps (Playwright's webm is variable-rate), drop the cut stretches, renumber frames.
const video = path.join(work, "cut.mp4");
const drop = cuts.length ? cuts.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+") : "0";
sh(`ffmpeg -y -loglevel error -i "${recording}" -vf "fps=25,select='not(${drop})',setpts=N/25/TB" -an -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p "${video}"`);

const list: string[] = [];
let cursor = 0;
const silence = (sec: number, out: string) => sh(`ffmpeg -y -loglevel error -f lavfi -i anullsrc=r=44100:cl=mono -t ${sec.toFixed(3)} "${out}"`);
for (const s of SCENES) {
  const mp3 = path.join(NARR_DIR, `${s.id}-${SET}.mp3`);
  const at = starts[s.id];
  if (at === undefined) throw new Error(`No recorded start for ${s.id}`);
  const wav = path.join(work, `${s.id}.wav`);
  const lead = path.join(work, `${s.id}-lead.wav`);
  sh(`ffmpeg -y -loglevel error -i "${mp3}" -ar 44100 -ac 1 "${wav}"`);
  silence(Math.max(at + 0.15 - cursor, 0.05), lead);
  list.push(`file '${lead}'`, `file '${wav}'`);
  cursor = Math.max(at + 0.15, cursor) + probe(wav);
}
const videoDur = probe(video);
if (videoDur > cursor) {
  const tail = path.join(work, "tail.wav");
  silence(videoDur - cursor + 0.25, tail);
  list.push(`file '${tail}'`);
}
fs.writeFileSync(path.join(work, "concat.txt"), list.join("\n"));
const audio = path.join(work, "audio.wav");
sh(`ffmpeg -y -loglevel error -f concat -safe 0 -i "${path.join(work, "concat.txt")}" -c copy "${audio}"`);
const plain = path.join(OUT_DIR, `${SET}.mp4`);
sh(`ffmpeg -y -loglevel error -i "${video}" -i "${audio}" -c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest -movflags +faststart "${plain}"`);

// Captions: ≤14-word chunks timed by word share of each line, from the caption text (numbers and addresses as written).
const srtTime = (sec: number) => {
  const ms = Math.round(sec * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const chunk = (text: string) => {
  const out: string[] = [];
  for (const raw of text.match(/.+?[.!?]+(?=\s|$)/g) ?? [text]) {
    const s = raw.trim();
    if (s.split(" ").length <= 14) { out.push(s); continue; }
    let buf: string[] = [];
    for (const part of s.split(/(?<=,)\s/)) {
      if ([...buf, part].join(" ").split(" ").length > 14 && buf.length) { out.push(buf.join(" ")); buf = [part]; }
      else buf.push(part);
    }
    if (buf.length) out.push(buf.join(" "));
  }
  return out;
};
const srt: string[] = [];
let n = 1;
for (const s of SCENES) {
  const dur = probe(path.join(NARR_DIR, `${s.id}-${SET}.mp3`));
  const parts = chunk(s.caption);
  const words = parts.reduce((k, c) => k + c.split(" ").length, 0);
  let t = starts[s.id]! + 0.15;
  for (const c of parts) {
    const end = t + (c.split(" ").length / words) * dur;
    srt.push(`${n++}\n${srtTime(t)} --> ${srtTime(Math.max(end - 0.001, t + 0.2))}\n${c}\n`);
    t = end;
  }
}
const srtPath = path.join(OUT_DIR, `${SET}.srt`);
fs.writeFileSync(srtPath, srt.join("\n"));
// Plain temp path: dots/spaces in the repo path break ffmpeg's filter escaping.
const tmpSrt = path.join(work, "captions.srt");
fs.copyFileSync(srtPath, tmpSrt);
const style = "FontName=Arial,FontSize=16,PrimaryColour=&H00FFFFFF,BackColour=&H90000000,BorderStyle=4,Outline=1,Shadow=0,MarginV=18,MarginL=20,MarginR=20,Alignment=2";
const final = path.join(OUT_DIR, `${SET}-subtitled.mp4`);
try {
  sh(`ffmpeg -y -loglevel error -i "${plain}" -vf "subtitles=${tmpSrt}:force_style='${style}'" -c:a copy -c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p -movflags +faststart "${final}"`);
} catch {
  console.warn("Burn-in failed (no libass?); adding a soft caption track instead");
  sh(`ffmpeg -y -loglevel error -i "${plain}" -i "${tmpSrt}" -c:v copy -c:a copy -c:s mov_text -metadata:s:s:0 language=eng "${final}"`);
}
fs.rmSync(work, { recursive: true, force: true });
console.log(`✅ ${final} (${probe(final).toFixed(1)}s)`);
