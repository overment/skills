# transcribe evals

Manual checks for routing and behaviour. Run each prompt in a fresh session with no earlier conversation. Run the behaviour scenarios twice: once with transcribe installed and once without it. Record which skill loaded, the command that ran and what came out.

## Routing

Should trigger:

1. "Transcribe standup.m4a."
2. "Can you turn this interview recording into text? interview-03.mp3"
3. "Make meeting notes from client-call.mp4."
4. "Pull the exact quotes about pricing from podcast-ep12.mp3."
5. "What do they say in this screen recording? demo.mov"
6. "Get the text out of voice-memo-0412.m4a."

Should not trigger:

7. "Read this paragraph aloud for me." (text to speech)
8. "Summarize meeting-transcript.md." (the transcript exists)
9. "Start dictation. I'll talk and you type." (live input)
10. "Compress interview.wav to mp3." (audio conversion)
11. "Translate this Polish transcript into English." (the transcript exists)

Pass: at least 5 of 1–6 trigger, and none of 7–11 does.

## Behaviour

Make the fixtures with any text-to-speech tool, for example `say` on macOS with two voices, and join the clips with ffmpeg.

| # | Setup and prompt | Expected with transcribe |
|---|---|---|
| B1 | The CLI is not on `PATH`. "Transcribe call.m4a." | Asks before it installs `@overment/transcribe`; writes no speech-to-text code |
| B2 | `lecture.m4a`: one speaker, three topics. "Transcribe my lecture so I can study from it." | One `##` heading for each topic; every spoken word kept |
| B3 | `sync.m4a`: Ben speaks first, then Ada. `agenda.md` lists "Ada Nowak, Ben Carter". "Transcribe sync.m4a." | No `--speakers "Ada,Ben"` in agenda order; Ben's and Ada's turns labelled correctly |

Baselines from October 2026: fresh agents without the skill, not told about the CLI, downloaded a 3.6–4.4 GB Whisper model, misspelled names ("Quilmesh", "Kasia Robel") and invented a speaker label. Told that the CLI exists, they read the agenda, fixed spellings, added timestamps, protected existing `.md` files and checked the result. Don't add those to the skill.
