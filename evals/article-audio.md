# article-audio evals

Manual checks for routing and behaviour. Run each prompt in a fresh session with no earlier conversation. Run the behaviour scenarios twice: once with article-audio installed and invoked, and once without it and with the same request in plain words. Record which skill loaded, what was written, and every ElevenLabs request.

The skill is explicit-only (`disable-model-invocation: true`, and `allow_implicit_invocation: false` for Codex), so plain requests must never load it.

## Routing

Should load:

1. "/article-audio docs/guides/onboarding.md" (Claude Code or Cursor)
2. "$article-audio posts/launch.md, same voice as last time" (Codex)
3. "/article-audio notes/lekcja-04.md, it's in Polish"

Should not load:

4. "Make an audio version of this blog post." (a plain request: the skill is explicit-only)
5. "Read this paragraph aloud." (short text to speech, no file)
6. "Transcribe this podcast episode." (speech to text)
7. "Summarise this article in five bullets."
8. "Add an audio player with chapters to the lesson page." (the player, not the audio)

Pass: 1–3 load the skill, and none of 4–8 loads it or calls the ElevenLabs API.

## Behaviour

Use a real article of at least 20,000 characters, with figures whose alt text lists shapes and colours, at least one code block, one table, inline file paths and links.

| # | Setup and prompt | Expected with article-audio |
|---|---|---|
| B1 | No API key. "/article-audio <article>" | Writes `script.md`, runs `split` until nothing is blocked, reports the estimate, and stops with "the audio waits for the key". Makes no API call |
| B2 | Same article. Read the figures in `script.md` | Each figure is skipped, bridged in one sentence, or told as its point plus the facts the text uses. No colours, shapes, arrows or positions. No alt text read word for word |
| B3 | Same article. Read the code, the table and the paths in `script.md` | Code becomes what it does, the table becomes its point, and paths become the names people say. No "slash", "dot" or URL |
| B4 | Key present. "/article-audio <article>" | Generates one sample of at most 3,000 characters from a section with hard content, writes `sample.mp3`, shows the full cost, and waits. No full run before the user says yes |
| B5 | After B4 and a yes, with a full `audio.mp3`. "In s03-f02 the voice says 'L L M' wrong, fix it." | Edits `script.md`, runs `split` (only the touched fragment loses its audio), shows the cost, waits for a yes, then runs `synth --only`, and then `merge` |
| B6 | A Polish article with English terms and numbers that take case endings. "/article-audio <article>" | Script in Polish, English terms kept, those numbers written as words, `--language pl`. The sample report names terms to listen for |

Checks for every scenario:

- No `synth --yes` beyond the sample without a yes in this session. The key never appears in output, files or commits.
- `script.md` has no Markdown, square brackets or slashes, apart from IPA in double quotes.
- `manifest.json` lists every fragment with its text, character count and heading. After `merge`, every section has a start time, and the last section ends at the length of `audio.mp3`.
- The run without the skill does worse on B2 and B3: it reads alt text or paths aloud. It also spends without asking in B4. If it does not, the skill adds too little to justify its context.
