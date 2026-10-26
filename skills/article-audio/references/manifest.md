# Output format

Read this when a player, an audit step or another tool consumes the output. `scripts/article-audio.mjs` writes every field. Do not edit `manifest.json` by hand: edit `script.md` and run `split`.

## Folder

```
<dir>/
  script.md        the spoken script; the source of every fragment text
  manifest.json    fragments, sections, settings, times
  fragments/       every take, <id>.<hash8>.<seed>.mp3, as the API returned it; old takes stay
  audio.mp3        the merged file, written by merge
  sample.mp3       written by merge --partial; not listed in the manifest
```

A player needs only `audio.mp3` and `manifest.json`.

## manifest.json

Times are seconds in `audio.mp3`, with three decimals. They are `null` until `merge` runs, and `merge` rewrites them each time. This is format `version` 3.

| Field | Meaning |
|---|---|
| `title` | From the `# Title` line of the script |
| `source` | The article path given to `split --source` |
| `tts` | `model`, `voiceId`, `voiceSettings` (stability, similarity_boost; `null` until the first `synth --yes` reads them from the voice), `settingsOverride` (values given to `split`, which win over the voice's), `seed` (used for first takes), `languageCode`, `outputFormat`. One set for the whole file |
| `split` | `targetChars`, `maxChars` |
| `merge` | Gaps (`gapSeconds` between fragments, `sectionGapSeconds` before a section), loudness target, sample rate, channels, bitrate |
| `estimate` | `chars`, `minutes`, `usd` for generating every fragment once, at list price |
| `billedChars` | Characters the API billed for every take so far, retakes included |
| `output` | `file`, `duration`, `format`, `bitrate`, `sampleRate`, `channels`, `loudness` (integrated LUFS measured as dual mono, true peak, LRA), `mergedAt`. `null` until the first full merge |
| `sections[]` | Chapters: `id` (`s01`), `title` (the `##` line), `fragments` (ids in order), `start`, `end` |
| `fragments[]` | See below |

A fragment:

| Field | Meaning |
|---|---|
| `id` | `s03-f02`: second fragment of the third section. Ids are positions, so they can change when the script changes. Use `textHash` to follow one text |
| `section`, `heading` | Section id and the source heading |
| `text` | The exact text sent to the API |
| `chars` | Characters in `text`. The estimate prices these at list price; the API can bill fewer |
| `textHash` | SHA-256 of `text` |
| `start`, `end` | Position of the spoken part in `audio.mp3` |
| `audio` | `null` before `synth`. Otherwise: `file`, `requestId`, `generatedAt`, `textHash` and `ttsHash` (what the audio was made from), `seed` (of this take), `characterCost` (from the API's `character-cost` header), `duration` (of the fragment file), `bytes`, `stitching` (which continuity fields the request sent) |

Audio is current when `audio.textHash` equals `textHash` and `audio.ttsHash` matches the `tts` block. The seed is not part of `ttsHash`: `synth --force` makes a retake with the take's seed plus one, because v4 returns almost the same take for the same seed and words. `status <dir>` prints each fragment's state: `none`, `current`, `stale-text`, `stale-settings` or `missing-file`. `merge` refuses to run while a fragment is not current.

## Audio

`audio.mp3`: MP3, mono, 44.1 kHz, 96 kbps CBR, ID3v2.3 title. Loudness is −16 LUFS measured as dual mono, which is −19 LUFS as plain mono, with a true peak of at most −1.5 dBTP. Each fragment is faded for 10 ms at its outer edges, trimmed of the silence that the model leaves at its ends, faded again for 8 ms at both ends, and joined with 0.5 s of silence, or 1.3 s before a new section.

For an audit, compare `fragments[].text` with a transcript of `fragments[].audio.file`, or of the span from `start` to `end` in `audio.mp3`.
