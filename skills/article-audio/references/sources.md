# Facts and sources

Read this when a limit, a price or an API behaviour matters, or when ElevenLabs changes the model. Checked on 21 October 2026. ElevenLabs says that Eleven v4 "is under active, continuous development", so confirm a fact in the linked page before you rely on it.

## Eleven v4

- Model ids: `eleven_v4` (quality, for narration and audiobooks) and `eleven_v4_turbo` (low latency, for agents). Launched on 28 September 2026. The API default is still `eleven_multilingual_v2`, so always send `model_id`. [Models](https://elevenlabs.io/docs/overview/models), [Eleven v4](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4)
- Limit: 10,000 characters per request, about 10 minutes of audio. [Models: character limits](https://elevenlabs.io/docs/overview/models#character-limits)
- Voice settings: only stability and similarity. "Style and Speed sliders are not available in Eleven v4, and SSML is not supported." [Eleven v4](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4)
- Pauses: no SSML break tags. Use punctuation, ellipses, text structure, or audio tags. [Best practices: pauses](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices#pauses)
- Audio tags: words in square brackets direct the delivery (`[whispers]`, `[sighs]`). A tag can come out as a sound effect instead. Capitals increase emphasis. Ellipses add pauses and weight. [Prompting Eleven v4](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v4)
- Pronunciation: v4 reads IPA between forward slashes, `"/ˌbaɪoʊˈkemɪstri/"`. Pronunciation dictionaries (`pronunciation_dictionary_locators`, up to 3 per request) take phoneme or alias rules. [Best practices: pronunciation](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices#pronunciation), [Pronunciation dictionaries](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/pronunciation-dictionaries)
- Text normalization: `apply_text_normalization` is `auto` by default and spells out numbers and dates. `language_code` (ISO 639-1) sets the language for the model and for normalization. [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert), [Best practices: text normalization](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices#text-normalization)
- Languages: more than 90, Polish and English included. When the text language differs from the voice's language, v4 speaks the text language fluently instead of keeping the voice's accent. [Eleven v4: native accent handling](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4#native-accent-handling)

## Continuity between requests

- `previous_request_ids` and `next_request_ids`: at most 3 each. When both are sent, they replace `previous_text` and `next_text`. `next_request_ids` is meant for regenerating one clip between two existing ones. [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
- Request stitching works with `eleven_v4`, but not with `eleven_v3`. A request id is usable for two hours. A streamed response must be read to the end before its id can be used. The ids are in the `request-id` response header, and the billed characters are in `character-cost`. Zero-retention mode (`enable_logging=false`, enterprise only) turns stitching off. [Stitching multiple requests](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/request-stitching)
- `seed` (0 to 4294967295) makes sampling as repeatable as possible, with no guarantee. [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)

## Price, formats and limits

- Price: $0.08 per 1,000 characters for `eleven_v4`, and $0.04 for `eleven_v4_turbo`. Plans include characters: Free 10,000 a month, Starter 75,000, Creator 275,000. [API pricing](https://elevenlabs.io/pricing/api)
- Output formats: `mp3_44100_128` (the default) works on every plan. `mp3_44100_192` needs Creator or higher. PCM and WAV at 44.1 kHz need Pro or higher. [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
- Concurrency: Free 2 requests at a time, Starter 3, Creator 5, Pro 10, Scale and Business 15. A 429 response has the code `rate_limit_exceeded` or `concurrent_limit_exceeded`. Wait and retry with backoff. A 402 response means that the account has no credits left. [Concurrency and priority](https://elevenlabs.io/docs/overview/models#concurrency-and-priority), [Errors](https://elevenlabs.io/docs/eleven-api/resources/errors)
- Regional hosts: `api.us.elevenlabs.io`, `api.eu.residency.elevenlabs.io` and others. Set `ELEVENLABS_API_BASE` to use one. [Create speech: servers](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)

## Merge and loudness

- Joining: the concat demuxer joins files that have the same codec and parameters. Decoding each fragment to 16-bit PCM first makes the join sample-exact, and the start times are sums of sample counts. [ffmpeg formats: concat](https://ffmpeg.org/ffmpeg-formats.html#concat-1), [Concatenate](https://trac.ffmpeg.org/wiki/Concatenate)
- Trimming and fades: `silenceremove` with `areverse` trims both ends. `afade` removes clicks at the joins. [ffmpeg filters](https://ffmpeg.org/ffmpeg-filters.html#silenceremove)
- Loudness: two-pass `loudnorm`. The first pass measures, and the second applies the measured values with `linear=true`. `dual_mono=true` measures a mono file as it sounds on two speakers. [ffmpeg filters: loudnorm](https://ffmpeg.org/ffmpeg-filters.html#loudnorm)
- Targets: Apple recommends −16 LKFS ±1 dB and a true peak of at most −1 dBFS, measured before encoding. It also recommends 96 to 128 kbps for mono MP3 at 44.1 or 48 kHz. The usual convention for a plain mono file is −19 LUFS, which is what −16 measured as dual mono gives. [Apple Podcasts audio requirements](https://podcasters.apple.com/support/893-audio-requirements), [ITU-R BS.1770-5](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en), [Descript: podcast loudness standard](https://www.descript.com/blog/article/podcast-loudness-standard-getting-the-right-volume)
- Encoding: the MP3 muxer writes a Xing/LAME frame with the duration and the encoder delay, so decoders can drop the encoder's padding at the start. [ffmpeg formats: mp3](https://ffmpeg.org/ffmpeg-formats.html#mp3)

## Observed on real runs

Measurements, not documentation, from two English articles on `eleven_v4`, 22 October 2026. Run A: 19,458 characters in 14 fragments, a premade British narration voice with default settings. Run B: 31,630 characters in 23 fragments, a professional voice clone with its stored settings (stability 0.8, similarity 1.0).

- Speech rate: run A 790 to 900 characters a minute, 832 overall; run B 932 to 1,081, 993 overall. The rate depends on the voice. The documented "10,000 characters, about 10 minutes" held for run B and was 20% short for run A.
- Billing: the `character-cost` header and the account history agreed. The API billed 44% of the characters sent on both runs (8,563 of 19,458, and 13,916 of 31,630), on a Creator subscription.
- Edge silence: run A 20 to 90 ms before the speech and 90 to 180 ms after it; run B up to 100 ms before and 110 to 650 ms after.
- Level: run B's 23 fragments came back between −25.9 and −25.2 LUFS before normalisation, so the level did not jump at the joins.
- Decoder step: one fragment of run B ended in a 0.7 ms step to −41 dBFS. `silenceremove` judges the first samples on a part-filled window, so it stopped there and kept 0.4 s of tail; a longer window or median detection did not help, and `start_duration` cut 50 ms of speech at each end. A 10 ms fade before the trim removed the step and changed no other fragment.
- Pauses: a sentence end gave 0.3 to 0.6 s. A paragraph break added nothing. "…and MCP. Agents…" ran together with 50 ms between them; "…and the command line. Agents…" got 0.5 s.
- Seed: with the same seed, a fragment with an added paragraph break came back as the same take, with the same length to the millisecond and the same pauses. The seed plus one gave a different take (63.44 s against 64.96 s).
- Reading: LLM, API, AI, ID, UTC, GPT, MCP and CLI came out as letters, and JSON as a word. Numbers in digits came out right: "41 percent", "465 kilometers", "48,000 yen", "2,300 of its 3,000", "November 2022".
