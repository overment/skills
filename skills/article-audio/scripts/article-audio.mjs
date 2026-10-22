#!/usr/bin/env node
// Spoken script -> fragments -> ElevenLabs Eleven v4 -> one normalised MP3, with a manifest.
// Runs on Node 18+ or Bun. No dependencies. Needs ffmpeg and ffprobe on PATH.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const HELP = `Usage: article-audio.mjs <command> <dir> [options]

<dir> holds script.md (the spoken script you wrote). The tool adds manifest.json,
fragments/ and audio.mp3 next to it.

Commands
  split  <dir>   Split script.md into fragments, write manifest.json, print the estimate.
                 Keeps audio of fragments whose text did not change.
                 --target <chars>   fragment size to aim for (default 1600)
                 --max <chars>      hard limit per fragment (default 2500)
                 --voice <id>       the voice (default: the configured default voice)
                 --stability <0..1> --similarity <0..1>   override the voice's stored settings
                 --seed <n>
                 --language <code>  ISO 639-1 code, for example en or pl
                 --source <path>    the article the script came from (recorded only)
  synth  <dir>   Generate audio for fragments that have none or are stale.
                 Without --yes it only prints what it would send and the cost.
                 --only <id,id>     limit to these fragment ids (or section ids like s02)
                 --force            regenerate even if audio is current (a retake, with a new seed)
                 --voice <id>       change the voice
                 --yes              spend credits
  merge  <dir>   Join all fragments into audio.mp3 and write start times to the manifest.
                 --partial          join only fragments that have audio, into sample.mp3
  status <dir>   List fragments, their audio state, and the characters billed so far.
  voices         List the voices on the account (no cost).

API key: ELEVENLABS_API_KEY, or the file ~/.config/elevenlabs/api_key.
Default voice: ELEVENLABS_VOICE_ID, or the file ~/.config/elevenlabs/voice_id.
Voice settings: the voice's stored stability and similarity, read when synth first runs.
API host: ELEVENLABS_API_BASE (default https://api.elevenlabs.io).
`;

const MODEL = "eleven_v4";
const OUTPUT_FORMAT = "mp3_44100_128"; // allowed on every plan; merge re-encodes once
const USD_PER_1K_CHARS = 0.08; // eleven_v4 list price per character, https://elevenlabs.io/pricing/api (October 2026)
const CHARS_PER_MINUTE = 830; // eleven_v4 narration measured at 790 to 900 characters a minute (October 2026)
const MODEL_CHAR_LIMIT = 10000;
const STITCH_MAX_AGE_MS = 110 * 60 * 1000; // request ids work for 2 hours; keep a margin
const MERGE = {
  gapSeconds: 0.5, // between fragments inside a section
  sectionGapSeconds: 1.3, // before a new section
  loudness: { I: -16, TP: -1.5, LRA: 11, dualMono: true }, // mono measured as dual mono = -19 LUFS mono
  sampleRate: 44100,
  channels: 1,
  bitrate: "96k",
};

// ---------- small helpers ----------

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[name] = true;
    else {
      flags[name] = next;
      i++;
    }
  }
  return { positional, flags };
}

function numberFlag(flags, name, fallback, min, max) {
  if (flags[name] === undefined) return fallback;
  const value = Number(flags[name]);
  if (!Number.isFinite(value) || value < min || value > max) fail(`--${name} must be a number from ${min} to ${max}`);
  return value;
}

const sha = (text) => createHash("sha256").update(text).digest("hex");
const charCount = (text) => [...text].length;
const usd = (chars) => (chars / 1000) * USD_PER_1K_CHARS;
const money = (value) => `$${value.toFixed(2)}`;
const minutes = (chars) => (chars / CHARS_PER_MINUTE).toFixed(1);

function readManifest(dir) {
  const path = join(dir, "manifest.json");
  if (!existsSync(path)) fail(`${path} not found; run split first`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeManifest(dir, manifest) {
  manifest.updatedAt = new Date().toISOString();
  const path = join(dir, "manifest.json");
  writeFileSync(`${path}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

// What the audio depends on, apart from its text. The seed is left out: a retake changes it on purpose.
function ttsHash(tts) {
  const { model, voiceId, voiceSettings, languageCode, outputFormat } = tts;
  return sha(JSON.stringify({ model, voiceId, voiceSettings, languageCode, outputFormat })).slice(0, 16);
}

// Audio is current when it was made from this exact text with these exact settings.
function audioState(fragment, manifest) {
  if (!fragment.audio) return "none";
  if (fragment.audio.textHash !== fragment.textHash) return "stale-text";
  if (fragment.audio.ttsHash !== ttsHash(manifest.tts)) return "stale-settings";
  if (!existsSync(join(manifest.dir, fragment.audio.file))) return "missing-file";
  return "current";
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) fail(`${cmd} failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`${cmd} ${args.join(" ")}\n${result.stderr.slice(-2000)}`);
  return result;
}

function probeDuration(file) {
  const out = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).stdout;
  return Number(Number(out.trim()).toFixed(3));
}

function probeSamples(file) {
  const out = run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration_ts", "-of", "csv=p=0", file]).stdout;
  return Number(out.trim());
}

// ---------- script parsing and checks ----------

// The script is plain spoken text. Allowed structure: "# Title" (not spoken), "## Section"
// (not spoken; the chapter name), blank lines between paragraphs, and <!-- notes --> (not spoken).
function parseScript(source) {
  const text = source.replace(/<!--[\s\S]*?-->/g, "");
  let title = null;
  const sections = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    if (sections.length === 0) sections.push({ title: title ?? "Opening", paragraphs: [] });
    sections.at(-1).paragraphs.push(paragraph.join(" "));
    paragraph = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{1,2})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      if (heading[1] === "#" && title === null && sections.length === 0) title = heading[2].trim();
      else sections.push({ title: heading[2].trim(), paragraphs: [] });
    } else if (line === "") flush();
    else paragraph.push(line);
  }
  flush();
  return { title, sections: sections.filter((section) => section.paragraphs.length > 0) };
}

// Text that Eleven v4 reads wrongly or that shows the script is still Markdown.
// IPA written the v4 way, "/ˈaɪ.pə/" in double quotes, is the one allowed use of slashes.
const IPA = /"\/[^/"]+\/"/g;
const BLOCKERS = [
  [/\[[^\]]*\]/, "square brackets: v4 reads [..] as an audio tag or a sound effect"],
  [/\//, "slash: v4 reads /../ as IPA; write 'and', 'or', 'per' or the name instead"],
  [/\*\*|__|`/, "Markdown emphasis or code marks"],
  [/https?:|www\./, "a URL"],
  [/^\s*([-*+]|\d+[.)])\s|(^|\s)#{1,6}\s/, "a list marker or a heading inside a paragraph"],
  [/\|/, "a table pipe"],
  [/<[a-z/][^>]*>/i, "an HTML or SSML tag (v4 does not support SSML)"],
];
const WARN_CHARS = /[~→←↔⇒≈≥≤×÷&@#_=+{}^\\§•]/u;
const MIXED_TOKEN = /\b(?!\d+(st|nd|rd|th|s)\b)(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z\d]+\b/;

function checkParagraph(paragraph) {
  const text = paragraph.replace(IPA, "");
  const problems = [];
  for (const [pattern, why] of BLOCKERS) if (pattern.test(text)) problems.push(why);
  const warnings = [];
  const symbol = WARN_CHARS.exec(text);
  if (symbol) warnings.push(`symbol "${symbol[0]}": check how it is read, or write it as words`);
  const mixed = MIXED_TOKEN.exec(text);
  if (mixed) warnings.push(`"${mixed[0]}" mixes letters and digits: write it as it is spoken`);
  return { problems, warnings };
}

// ---------- splitting ----------

function sentences(paragraph) {
  return paragraph.split(/(?<=[.!?…])\s+(?=\S)/u);
}

const joinParts = (parts) => parts.join("\n\n");

// A paragraph longer than `max` is cut at sentence ends into pieces of about `target`.
function paragraphUnits(paragraphs, target, max) {
  const units = [];
  for (const paragraph of paragraphs) {
    if (charCount(paragraph) <= max) {
      units.push(paragraph);
      continue;
    }
    let chunk = "";
    for (const sentence of sentences(paragraph)) {
      if (charCount(sentence) > max) fail(`a sentence is longer than ${max} characters: "${sentence.slice(0, 80)}..."`);
      const joined = chunk ? `${chunk} ${sentence}` : sentence;
      if (charCount(joined) > target && chunk) {
        units.push(chunk);
        chunk = sentence;
      } else chunk = joined;
    }
    if (chunk) units.push(chunk);
  }
  return units;
}

// Whole units packed up to `target`, never over `max`. A short tail joins the fragment before it.
function greedy(units, target, max) {
  const min = Math.round(target / 3);
  const fragments = [];
  let current = [];
  const size = (parts) => charCount(joinParts(parts));
  for (const unit of units) {
    const candidate = [...current, unit];
    if (current.length > 0 && size(candidate) > target && (size(current) >= min || size(candidate) > max)) {
      fragments.push(current);
      current = [unit];
    } else current = candidate;
  }
  if (current.length > 0) {
    const previous = fragments.at(-1);
    if (previous && size(current) < min && size([...previous, ...current]) <= max) previous.push(...current);
    else fragments.push(current);
  }
  return fragments;
}

// Fragments of one section. A run of units that is exactly the text of a fragment that already
// has audio stays one fragment, so an edit regenerates only the fragments it touches.
function packSection(paragraphs, target, max, voiced) {
  const units = paragraphUnits(paragraphs, target, max);
  const fragments = [];
  let pending = [];
  for (let i = 0; i < units.length; ) {
    let match = 0;
    for (let length = 1; i + length <= units.length; length++) {
      const text = joinParts(units.slice(i, i + length));
      if (charCount(text) > max) break;
      if (voiced.has(text)) match = length;
    }
    if (match === 0) {
      pending.push(units[i++]);
      continue;
    }
    fragments.push(...greedy(pending, target, max), units.slice(i, i + match));
    pending = [];
    i += match;
  }
  fragments.push(...greedy(pending, target, max));
  return fragments.map(joinParts);
}

function commandSplit(dir, flags) {
  const scriptPath = join(dir, "script.md");
  if (!existsSync(scriptPath)) fail(`${scriptPath} not found; write the spoken script there first`);
  const target = numberFlag(flags, "target", 1600, 300, MODEL_CHAR_LIMIT);
  const max = numberFlag(flags, "max", Math.max(2500, target), target, MODEL_CHAR_LIMIT);
  const parsed = parseScript(readFileSync(scriptPath, "utf8"));
  if (parsed.sections.length === 0) fail("script.md has no spoken text");

  let blocked = 0;
  for (const section of parsed.sections) {
    for (const paragraph of section.paragraphs) {
      const { problems, warnings } = checkParagraph(paragraph);
      const where = `[${section.title}] "${paragraph.slice(0, 70)}..."`;
      for (const why of problems) {
        console.error(`blocked: ${why}\n  in ${where}`);
        blocked++;
      }
      for (const why of warnings) console.error(`warning: ${why}\n  in ${where}`);
    }
  }
  if (blocked > 0) fail(`${blocked} problem(s) in script.md; fix them and run split again`);

  const old = existsSync(join(dir, "manifest.json")) ? readManifest(dir) : null;
  const fallback = defaultVoice();
  const voiceId = typeof flags.voice === "string" ? flags.voice : old?.tts.voiceId ?? fallback?.id ?? null;
  const settingsOverride = {
    stability: numberFlag(flags, "stability", old?.tts.settingsOverride?.stability ?? null, 0, 1),
    similarity_boost: numberFlag(flags, "similarity", old?.tts.settingsOverride?.similarity_boost ?? null, 0, 1),
  };
  // Settings read from this voice before stay; flags change them. A new voice reads its own at synth.
  const keptSettings = old?.tts.voiceId === voiceId && old?.tts.voiceSettings ? old.tts.voiceSettings : null;
  const tts = {
    provider: "elevenlabs",
    model: MODEL,
    voiceId,
    voiceSettings: keptSettings ? applyOverride(keptSettings, settingsOverride) : fullOverride(settingsOverride),
    settingsOverride,
    seed: numberFlag(flags, "seed", old?.tts.seed ?? Math.floor(Math.random() * 4294967295), 0, 4294967295),
    languageCode: typeof flags.language === "string" ? flags.language : old?.tts.languageCode ?? null,
    outputFormat: OUTPUT_FORMAT,
  };
  if (!voiceId) console.log("No voice yet: pass --voice <id>, or set a default in ELEVENLABS_VOICE_ID or ~/.config/elevenlabs/voice_id.");
  else if (!flags.voice && !old?.tts.voiceId && fallback) console.log(`Voice: ${voiceId}, the default from ${fallback.from}.`);

  // Keep audio made from identical text, even when the fragment id moved.
  const oldByHash = new Map();
  for (const fragment of old?.fragments ?? []) {
    if (fragment.audio?.textHash === fragment.textHash && !oldByHash.has(fragment.textHash)) oldByHash.set(fragment.textHash, fragment.audio);
  }
  const voiced = new Set((old?.fragments ?? []).filter((fragment) => oldByHash.has(fragment.textHash)).map((fragment) => fragment.text));

  const sections = [];
  const fragments = [];
  parsed.sections.forEach((section, s) => {
    const sectionId = `s${String(s + 1).padStart(2, "0")}`;
    const ids = [];
    packSection(section.paragraphs, target, max, voiced).forEach((text, f) => {
      const id = `${sectionId}-f${String(f + 1).padStart(2, "0")}`;
      const textHash = sha(text);
      const audio = oldByHash.get(textHash) ?? null;
      oldByHash.delete(textHash);
      fragments.push({ id, section: sectionId, heading: section.title, chars: charCount(text), textHash, text, audio, start: null, end: null });
      ids.push(id);
    });
    sections.push({ id: sectionId, title: section.title, fragments: ids, start: null, end: null });
  });

  const totalChars = fragments.reduce((sum, fragment) => sum + fragment.chars, 0);
  const manifest = {
    version: 3,
    title: parsed.title ?? old?.title ?? null,
    source: typeof flags.source === "string" ? flags.source : old?.source ?? null,
    script: "script.md",
    createdAt: old?.createdAt ?? new Date().toISOString(),
    updatedAt: null,
    tts,
    split: { targetChars: target, maxChars: max },
    merge: MERGE,
    estimate: { chars: totalChars, minutes: Number(minutes(totalChars)), usd: Number(usd(totalChars).toFixed(2)), usdPer1kChars: USD_PER_1K_CHARS },
    billedChars: old?.billedChars ?? 0,
    output: null,
    sections,
    fragments,
  };
  writeManifest(dir, manifest);

  const kept = fragments.filter((fragment) => fragment.audio).length;
  console.log(`${sections.length} sections, ${fragments.length} fragments, ${totalChars} characters (about ${minutes(totalChars)} min of audio).`);
  console.log(`Full generation: about ${money(usd(totalChars))} at the list price of ${money(USD_PER_1K_CHARS)} per 1,000 characters. The API can bill fewer characters.`);
  if (kept > 0) console.log(`${kept} fragment(s) keep their audio because their text did not change.`);
  const sizes = fragments.map((fragment) => fragment.chars);
  console.log(`Fragment size: min ${Math.min(...sizes)}, max ${Math.max(...sizes)} characters.`);
}

// ---------- ElevenLabs ----------

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY?.trim()) return process.env.ELEVENLABS_API_KEY.trim();
  const file = join(homedir(), ".config", "elevenlabs", "api_key");
  if (existsSync(file)) {
    const key = readFileSync(file, "utf8").trim();
    if (key) return key;
  }
  fail("no API key: set ELEVENLABS_API_KEY or write the key to ~/.config/elevenlabs/api_key");
}

// A voice id belongs to one account, so the default voice is the user's config, not the skill's.
function defaultVoice() {
  if (process.env.ELEVENLABS_VOICE_ID?.trim()) return { id: process.env.ELEVENLABS_VOICE_ID.trim(), from: "ELEVENLABS_VOICE_ID" };
  const file = join(homedir(), ".config", "elevenlabs", "voice_id");
  if (existsSync(file)) {
    const id = readFileSync(file, "utf8").trim();
    if (id) return { id, from: "~/.config/elevenlabs/voice_id" };
  }
  return null;
}

const NO_VOICE = "no voice: pass --voice <id>, or set a default in ELEVENLABS_VOICE_ID or ~/.config/elevenlabs/voice_id (the voices command lists them)";

// eleven_v4 uses only stability and similarity. Keys stay in this order, because ttsHash hashes them.
const settings = (stability, similarity_boost) => ({ stability, similarity_boost });
const applyOverride = (base, override = {}) => settings(override.stability ?? base.stability, override.similarity_boost ?? base.similarity_boost);
const fullOverride = (override = {}) => (override.stability != null && override.similarity_boost != null ? settings(override.stability, override.similarity_boost) : null);
const describeSettings = (s) => (s ? `stability ${s.stability}, similarity ${s.similarity_boost}` : "the voice's stored settings");

// A cloned voice's stored settings are its owner's tuning, so they are the default, not the API's.
async function storedSettings(tts, key) {
  const response = await request(`${apiBase()}/v1/voices/${encodeURIComponent(tts.voiceId)}/settings`, { headers: { "xi-api-key": key } });
  const stored = await response.json();
  return applyOverride(settings(stored.stability ?? 0.5, stored.similarity_boost ?? 0.75), tts.settingsOverride);
}

const apiBase = () => (process.env.ELEVENLABS_API_BASE ?? "https://api.elevenlabs.io").replace(/\/$/, "");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Retries rate limits and server errors with backoff. Other errors stop the run.
async function request(url, init) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(300_000) });
    } catch (error) {
      if (attempt >= 4) fail(`request failed: ${error.message}`);
      await sleep(2000 * attempt);
      continue;
    }
    if (response.ok) return response;
    const body = await response.text();
    const retry = response.status === 429 || response.status >= 500;
    if (!retry || attempt >= 6) fail(`ElevenLabs answered ${response.status}: ${body.slice(0, 600)}`);
    const wait = Math.min(60, 2 ** attempt) * 1000;
    console.error(`ElevenLabs answered ${response.status}; retrying in ${wait / 1000} s`);
    await sleep(wait);
  }
}

function fresh(audio) {
  return audio?.requestId && Date.now() - Date.parse(audio.generatedAt) < STITCH_MAX_AGE_MS;
}

// Continuity: the request ids of up to 3 fragments just before, and of the fragment just after,
// while those are current and fresh; otherwise the neighbouring text.
function stitching(manifest, index) {
  const { fragments } = manifest;
  const usable = (fragment) => fragment && audioState(fragment, manifest) === "current" && fresh(fragment.audio);
  const context = {};
  const previousIds = [];
  for (let i = index - 1; i >= Math.max(0, index - 3) && usable(fragments[i]); i--) previousIds.unshift(fragments[i].audio.requestId);
  if (previousIds.length > 0) context.previous_request_ids = previousIds;
  else if (index > 0) context.previous_text = fragments[index - 1].text;
  const next = fragments[index + 1];
  if (usable(next)) context.next_request_ids = [next.audio.requestId];
  else if (next) context.next_text = next.text;
  return context;
}

function selectFragments(manifest, only, force) {
  const wanted = only ? new Set(only.split(",").map((id) => id.trim()).filter(Boolean)) : null;
  if (wanted) {
    const known = new Set([...manifest.fragments.map((fragment) => fragment.id), ...manifest.sections.map((section) => section.id)]);
    for (const id of wanted) if (!known.has(id)) fail(`unknown fragment or section id: ${id}`);
  }
  return manifest.fragments.filter((fragment) => {
    if (wanted && !wanted.has(fragment.id) && !wanted.has(fragment.section)) return false;
    return force || audioState(fragment, manifest) !== "current";
  });
}

async function commandSynth(dir, flags) {
  const manifest = readManifest(dir);
  manifest.dir = dir;
  const { tts } = manifest;
  // A new voice makes existing audio stale-settings, so the plan below includes it.
  if (typeof flags.voice === "string" && flags.voice !== tts.voiceId) {
    tts.voiceId = flags.voice;
    tts.voiceSettings = fullOverride(tts.settingsOverride);
  }
  tts.voiceId ??= defaultVoice()?.id ?? null;
  const spend = flags.yes === true;
  let key = null;
  if (spend) {
    if (!tts.voiceId) fail(NO_VOICE);
    key = apiKey();
    tts.voiceSettings ??= await storedSettings(tts, key);
  }
  const targets = selectFragments(manifest, typeof flags.only === "string" ? flags.only : null, flags.force === true);
  if (targets.length === 0) {
    console.log("Nothing to generate: every selected fragment has current audio.");
    return;
  }
  const chars = targets.reduce((sum, fragment) => sum + fragment.chars, 0);
  const plan = `${targets.length} fragment(s), ${chars} characters, about ${money(usd(chars))} (${minutes(chars)} min)`;
  const voice = `voice ${tts.voiceId ?? "not set (pass --voice)"}, ${describeSettings(tts.voiceSettings)}`;
  if (!spend) {
    for (const fragment of targets) console.log(`  ${fragment.id}  ${String(fragment.chars).padStart(5)} chars  ${audioState(fragment, manifest)}  ${fragment.heading}`);
    console.log(`Dry run: would generate ${plan} with ${tts.model}, ${voice}. Add --yes to spend.`);
    return;
  }

  mkdirSync(join(dir, "fragments"), { recursive: true });
  const hash = ttsHash(tts);
  console.log(`Generating ${plan} with ${tts.model}, ${voice}.`);
  let billed = 0;
  for (const target of targets) {
    const index = manifest.fragments.indexOf(target);
    // v4 returns almost the same take for the same seed and words, so a retake needs a new seed.
    const retake = audioState(target, manifest) === "current";
    const seed = retake ? ((target.audio.seed ?? manifest.tts.seed) + 1) % 4294967296 : manifest.tts.seed;
    const body = {
      text: target.text,
      model_id: manifest.tts.model,
      voice_settings: manifest.tts.voiceSettings,
      seed,
      ...(manifest.tts.languageCode ? { language_code: manifest.tts.languageCode } : {}),
      ...stitching(manifest, index),
    };
    const url = `${apiBase()}/v1/text-to-speech/${encodeURIComponent(manifest.tts.voiceId)}?output_format=${manifest.tts.outputFormat}`;
    const response = await request(url, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify(body),
    });
    const audio = Buffer.from(await response.arrayBuffer());
    const file = `fragments/${target.id}.${target.textHash.slice(0, 8)}.${seed}.mp3`;
    writeFileSync(join(dir, `${file}.tmp`), audio);
    renameSync(join(dir, `${file}.tmp`), join(dir, file));
    const characterCost = Number(response.headers.get("character-cost") ?? Number.NaN);
    if (Number.isFinite(characterCost)) {
      billed += characterCost;
      manifest.billedChars = (manifest.billedChars ?? 0) + characterCost;
    }
    target.audio = {
      file,
      requestId: response.headers.get("request-id"),
      generatedAt: new Date().toISOString(),
      textHash: target.textHash,
      ttsHash: hash,
      seed,
      characterCost: Number.isFinite(characterCost) ? characterCost : null,
      duration: probeDuration(join(dir, file)),
      bytes: audio.length,
      stitching: Object.keys(body).filter((name) => name.startsWith("previous_") || name.startsWith("next_")),
    };
    const { dir: _dir, ...saved } = manifest;
    writeManifest(dir, saved);
    console.log(`  ${target.id}  ${target.chars} chars  ${target.audio.duration} s${retake ? `  retake, seed ${seed}` : ""}`);
  }
  console.log(billed ? `Done. The API billed ${billed} characters, ${money(usd(billed))} at list price.` : "Done. The API did not report billed characters.");
}

async function commandVoices() {
  const key = apiKey();
  const fallback = defaultVoice();
  let token = null;
  do {
    const query = new URLSearchParams({ page_size: "100", ...(token ? { next_page_token: token } : {}) });
    const response = await request(`${apiBase()}/v2/voices?${query}`, { headers: { "xi-api-key": key } });
    const page = await response.json();
    for (const voice of page.voices ?? []) {
      const labels = Object.values(voice.labels ?? {}).join(", ");
      const mark = voice.voice_id === fallback?.id ? "  <- default" : "";
      console.log(`${voice.voice_id}  ${voice.name}  (${voice.category}${labels ? `; ${labels}` : ""})${mark}`);
    }
    token = page.has_more ? page.next_page_token : null;
  } while (token);
  console.log(fallback ? `Default voice: ${fallback.id}, from ${fallback.from}.` : "No default voice: set ELEVENLABS_VOICE_ID or ~/.config/elevenlabs/voice_id.");
}

// ---------- merge ----------

// Trims the silence the model leaves at both ends, so the gaps below are exact, and fades
// 8 ms in and out so no join clicks.
const TRIM = [
  "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05",
  "afade=t=in:d=0.008",
  "areverse",
  "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.12",
  "afade=t=in:d=0.008",
  "areverse",
].join(",");

function commandMerge(dir, flags) {
  const manifest = readManifest(dir);
  manifest.dir = dir;
  const partial = flags.partial === true;
  const states = manifest.fragments.map((fragment) => [fragment, audioState(fragment, manifest)]);
  const notReady = states.filter(([, state]) => state !== "current");
  if (!partial && notReady.length > 0) {
    fail(`${notReady.length} fragment(s) without current audio: ${notReady.map(([fragment, state]) => `${fragment.id} (${state})`).join(", ")}`);
  }
  const fragments = states.filter(([, state]) => state === "current").map(([fragment]) => fragment);
  if (fragments.length === 0) fail("no fragment has current audio");

  const { sampleRate, channels, gapSeconds, sectionGapSeconds, loudness, bitrate } = manifest.merge;
  const work = join(dir, "work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const silence = (name, seconds) => {
    const file = join(work, name);
    run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `anullsrc=r=${sampleRate}:cl=mono`, "-t", String(seconds), "-ac", String(channels), "-c:a", "pcm_s16le", file]);
    return { file, samples: probeSamples(file) };
  };
  const gap = silence("gap.wav", gapSeconds);
  const sectionGap = silence("section-gap.wav", sectionGapSeconds);

  const list = [];
  let samples = 0;
  const positions = new Map();
  fragments.forEach((fragment, i) => {
    if (i > 0) {
      const pause = fragment.section !== fragments[i - 1].section ? sectionGap : gap;
      list.push(pause.file);
      samples += pause.samples;
    }
    const wav = join(work, `${fragment.id}.wav`);
    run("ffmpeg", ["-v", "error", "-i", join(dir, fragment.audio.file), "-af", TRIM, "-ar", String(sampleRate), "-ac", String(channels), "-c:a", "pcm_s16le", wav]);
    const length = probeSamples(wav);
    positions.set(fragment.id, { start: samples / sampleRate, end: (samples + length) / sampleRate });
    list.push(wav);
    samples += length;
  });
  const listFile = join(work, "list.txt");
  writeFileSync(listFile, list.map((file) => `file '${resolve(file).replaceAll("'", "'\\''")}'`).join("\n"));

  const target = `I=${loudness.I}:TP=${loudness.TP}:LRA=${loudness.LRA}:dual_mono=${loudness.dualMono}`;
  const input = ["-v", "info", "-f", "concat", "-safe", "0", "-i", listFile];
  const measuredLog = run("ffmpeg", [...input, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"]).stderr;
  const measured = JSON.parse(measuredLog.slice(measuredLog.lastIndexOf("{"), measuredLog.lastIndexOf("}") + 1));
  const second = `loudnorm=${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=json`;
  const outputName = partial ? "sample.mp3" : "audio.mp3";
  const outputPath = join(dir, outputName);
  const metadata = manifest.title ? ["-metadata", `title=${manifest.title}`] : [];
  const encodeLog = run("ffmpeg", ["-y", ...input, "-af", second, "-ar", String(sampleRate), "-ac", String(channels), "-c:a", "libmp3lame", "-b:a", bitrate, "-id3v2_version", "3", ...metadata, outputPath]).stderr;
  const result = JSON.parse(encodeLog.slice(encodeLog.lastIndexOf("{"), encodeLog.lastIndexOf("}") + 1));
  rmSync(work, { recursive: true, force: true });

  const duration = probeDuration(outputPath);
  const expected = samples / sampleRate;
  if (Math.abs(duration - expected) > 0.2) fail(`${outputName} is ${duration} s but the fragments add up to ${expected.toFixed(3)} s`);
  console.log(`${outputName}: ${duration} s, ${fragments.length} fragments, ${result.output_i} LUFS (dual mono), true peak ${result.output_tp} dBTP.`);
  if (partial) return; // a sample does not change the manifest

  const round = (value) => Number(value.toFixed(3));
  for (const fragment of manifest.fragments) {
    const position = positions.get(fragment.id);
    fragment.start = round(position.start);
    fragment.end = round(position.end);
  }
  for (const section of manifest.sections) {
    section.start = manifest.fragments.find((fragment) => fragment.id === section.fragments[0]).start;
    section.end = manifest.fragments.find((fragment) => fragment.id === section.fragments.at(-1)).end;
  }
  manifest.output = {
    file: outputName,
    duration,
    format: "mp3",
    bitrate,
    sampleRate,
    channels,
    loudness: { integrated: Number(result.output_i), truePeak: Number(result.output_tp), lra: Number(result.output_lra), dualMono: loudness.dualMono },
    mergedAt: new Date().toISOString(),
  };
  const { dir: _dir, ...saved } = manifest;
  writeManifest(dir, saved);
  console.log(`Wrote start and end times for ${manifest.sections.length} sections and ${manifest.fragments.length} fragments.`);
}

function commandStatus(dir) {
  const manifest = readManifest(dir);
  manifest.dir = dir;
  const counts = {};
  for (const fragment of manifest.fragments) {
    const state = audioState(fragment, manifest);
    counts[state] = (counts[state] ?? 0) + 1;
    const duration = fragment.audio?.duration ? `${fragment.audio.duration} s` : "";
    const start = fragment.start === null ? "" : `at ${fragment.start} s`;
    console.log(`${fragment.id}  ${String(fragment.chars).padStart(5)} chars  ${state.padEnd(14)} ${duration.padEnd(10)} ${start.padEnd(12)} ${fragment.heading}`);
  }
  console.log(Object.entries(counts).map(([state, n]) => `${n} ${state}`).join(", "));
  if (manifest.output) console.log(`Merged: ${manifest.output.file}, ${manifest.output.duration} s.`);
  if (manifest.billedChars) console.log(`Billed so far, every take included: ${manifest.billedChars} characters, ${money(usd(manifest.billedChars))} at list price.`);
}

// ---------- main ----------

const { positional, flags } = parseArgs(process.argv.slice(2));
const [command, dirArg] = positional;
if (!command || flags.help || command === "help") {
  console.log(HELP);
  process.exit(0);
}
if (command === "voices") await commandVoices();
else {
  if (!dirArg) fail(`${command} needs a directory`);
  const dir = resolve(dirArg);
  if (command === "split") commandSplit(dir, flags);
  else if (command === "synth") await commandSynth(dir, flags);
  else if (command === "merge") commandMerge(dir, flags);
  else if (command === "status") commandStatus(dir);
  else fail(`unknown command: ${command}\n\n${HELP}`);
}
