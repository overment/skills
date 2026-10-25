---
name: transcribe
description: Transcribes audio and video recordings with the `transcribe` CLI. Use when the user wants a transcript, notes or quotes from a recording.
license: MIT
metadata:
  author: overment
  version: "0.1.0"
---

# Transcribe

Use the `transcribe` CLI. Don't download a local model such as Whisper or write speech-to-text code. If the CLI is missing, ask before you run `npm install --global @overment/transcribe`.

- `--speakers` assigns names in order of first appearance, so a wrong order mislabels every turn. Use it only when you know who speaks first; otherwise name the participants in `--prompt`.
- For a lecture or talk with several topics, add to `--prompt`: "Add a level-2 Markdown heading at each topic change."
- A long recording takes several minutes. Give the command a long timeout or run it in the background.
