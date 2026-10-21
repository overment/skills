---
name: article-audio
description: Turns a long Markdown article into one narrated audio file with ElevenLabs Eleven v4 and ffmpeg, keeping each fragment and a manifest so single parts can be checked and regenerated. It spends API credits, so it runs only when invoked by name.
license: MIT
compatibility: Needs Node 18+ or Bun, ffmpeg with libmp3lame, and an ElevenLabs API key.
disable-model-invocation: true
metadata:
  author: overment
  version: "0.1.0"
---

# Article Audio

Without this skill, agents strip the Markdown and read what is left. Figure alt text comes out as a tour of boxes and arrows, file paths come out as "slash" and "dot", and nothing stops the run before it spends credits. Your job is the script: rewrite the article for the ear. `scripts/article-audio.mjs` does the fragile parts: splitting, Eleven v4 requests with request stitching, and a gapless, loudness-normalised merge.

## What invoking it authorises

The skill is explicit-only: `disable-model-invocation: true` for Claude Code and Cursor, `agents/openai.yaml` for Codex. Invoking it authorises the spoken script, the dry run, and one sample of at most 3,000 characters (about $0.25). The full run and every regeneration need a fresh yes after the user sees the estimate.

The key comes from `ELEVENLABS_API_KEY`, or from `~/.config/elevenlabs/api_key` when the variable is not set. Without a key, stop after the dry run and say that the audio waits for the key.

## Steps

Run the script with `node` or `bun`. `<dir>` is the output folder: `audio/` next to the article unless the user names another place.

1. Write `<dir>/script.md` in the article's language (see "Write for the ear"). `# Title` and `## Section` lines are not spoken: they name the audio and its chapters. Text before the first `##` becomes an opening chapter named after the title. A heading that only holds a list, such as an outline, folds into the section around it. Blank lines separate paragraphs. `<!-- notes -->` are not spoken.
2. `split <dir> --language <code> --source <article>`. Fix every `blocked` line. Check each `warning`, and change the text when the warning is right.
3. Ask for the voice if the user has not named one. `voices` lists the voices on the account.
4. Sample: pick the hardest content (terms, numbers, a figure), at most 3,000 characters: one section, or some fragments of a longer one. Run `synth <dir> --voice <id> --only <ids> --yes`, where `<ids>` are section ids (`s03`) or fragment ids (`s03-f01`). Then run `merge <dir> --partial`, which writes `sample.mp3`.
5. Show the user the sample path, what to listen for, and the full cost: `synth <dir>` without `--yes` prints it. Wait for a yes.
6. `synth <dir> --yes`, then `merge <dir>`. Report `audio.mp3`, the duration, and the billed characters.

To fix a fragment later, edit its text in `script.md` and run `split`: only the fragments whose text changed lose their audio. For a bad take of unchanged text, run `synth <dir> --only <id> --force --yes`. Then run `merge`. Both need the user's yes, as in step 5.

## Write for the ear

The script is a new text for a listener, not the article without its marks. Picture two listeners: one reads the article while listening, one walks with headphones and no screen. Every line must work for the walker, and no line may bore the reader. Keep the author's words and order wherever they already work aloud. Rewrite only what the ear cannot follow. Do not summarise and do not add claims.

Ask of each passage:

- Does the listener know where they are? Open with the title, and each section with its heading, as a short spoken line. Before a list of three or more items, say how many there are.
- Does a sentence point at the page ("below", "this table", "click here")? Make it work without the page.
- Is something read that nobody says aloud? File names, paths, commands and identifiers become the words people say: "the agents file", "the memory save tool". Keep the literal spelling only when the listener must type it.
- Is there a parenthesis, or a label with a colon ("State: holds the thread")? Make it a sentence of its own ("State holds the thread"), or drop it.
- Is it a code block or a table? Say what the code does, or what the table shows, and the one or two details the text relies on. Never read code or cells.

Eleven v4 facts that change the text:

- It has no SSML and no speed or style setting. Pauses come from sentence ends and paragraph breaks. The merge adds exact pauses between fragments and before each section, so do not add pause marks.
- Square brackets are audio tags, and a tag can come out as a sound effect. Text between slashes is read as IPA. `split` blocks both. The one exception is IPA written as `"/ˈwɜːrd/"` to fix a pronunciation.
- Capitals add stress. Write an all-capital name as a normal word ("Apex", not "APEX"). Keep acronyms that people say as letters (API, LLM).
- Write versions, codes and ranges as they are said: "season two, episode one", "version four", "from five to ten". In Polish, write a number as words when it takes a case ending ("w dwa tysiące dwudziestym szóstym roku"), and listen for it in the sample.
- In a Polish article, keep established English terms in English. If the sample mispronounces a term, respell it or use IPA, and fix it everywhere in the script.

## Figures: say the point, not the picture

Alt text describes a picture for someone who cannot see it, so it lists shapes, colours and positions. The listener needs what the figure means. Read the figure's alt text, its caption (under the image or inside it), and the paragraphs before and after it. If you can open the image, look at it. Authoring notes, such as drawing instructions in comments, can show the intent, but never read their wording.

Then ask what the walker would lose if the figure were skipped:

- **Nothing**, because the text already says it: skip the figure, or give one bridging sentence.
- **Facts**, because the text points at the figure ("like this:"), builds on it, or does not have what the figure shows (an example, a grouping): give the point in one sentence, then only those facts, as a flow of who does what and in what order. Two to four sentences. A figure that maps the whole article may need a few more.
- **Data** (a chart): the trend or the comparison, and the one or two numbers the text uses.

Leave out colours, shapes, arrows, positions, line styles, legends, and labels that repeat the text. Open with a light cue, so the reader can find the figure: "The diagram here shows…". Do not use "as you can see".

Alt text: "A flow diagram. A red box labelled Queue sits on the left. Three arrows lead to grey boxes labelled Worker 1, Worker 2 and Worker 3. A dashed arrow goes from each worker to a database cylinder on the right."
Script: "The diagram here shows one queue feeding three workers in parallel. Each worker writes its result to the same database."

## Fragments and output

`split` makes the fragments: whole paragraphs, never across a `##` section, about 1,600 characters each (about a minute and a half) and never more than 2,500. That size is short enough to check by ear and cheap to regenerate (about $0.13), and long enough for natural phrasing. Request stitching keeps the voice even across fragment borders. Keep paragraphs under about 1,000 characters, so that `split` has places to cut.

The player reads `audio.mp3` and `manifest.json`. The fields are in [references/manifest.md](references/manifest.md). Facts, prices and sources are in [references/sources.md](references/sources.md).
