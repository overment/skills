---
title: INC-204 · Stop is immediate, and a 429 ends the turn
mode: dark
chrome: title
---

```meta
chips:
  - desktop dev build
  - { id: commit, label: "local main · 1a0dfbe0b", refs: proof-landed, about: "The branch and commit that landed. Click the chip to copy the hash." }
  - { label: no origin push, tone: warn, about: "The fix is on the local main branch only; nothing has been pushed yet." }
status: { text: "Landed with review PASS · deploy check HTTP 200", tone: ok }
```

A [429](#e429) now ends the turn at once instead of [retrying out of sight](#retry), and [Stop](#stops) answers on the click: a [repeat press](#copy-repeat) went from 0.73–1.72 s to 0.8 ms.

```events
id: trace
title: What the reporter hit on 2026-09-26 (UTC)
tz: UTC
end: "10:09:19"
events:
  sent:
    at: "10:08:44"
    label: Message sent
    about: "The reporter sent a long prompt from the desktop app on a debug build. Try step 1 starts the same way."
    check: step-stream
  e429:
    at: "10:08:56"
    label: HTTP 429
    sub: painted as final
    tone: warn
    focal: true
    note: "The provider said 429. The app painted it as the final answer while a retry was already queued."
    about: "The provider answered *Too Many Requests*. The app showed it as final, but still counted 429 as *provider busy* and scheduled a retry."
    fix: c-429
    check: step-429
  retry:
    at: e429+2s
    label: silent retry
    sub: turn still running
    tone: warn
    place: above
    note: "A hidden retry 2 s later: the turn kept running under an error, so Stop stayed armed."
    about: "The retry fired 2 s after the error with nothing on screen. The turn kept running, so Stop stayed armed under an answer that looked final."
    fix: c-429
  title:
    at: e429+2.7s
    label: title lands after the error
    about: "The thread title came from a side request that the 429 did not cancel. Ending the turn at once now cancels it too."
    fix: c-429
spans:
  prep:
    from: "10:08:44.4"
    to: "10:08:55"
    label: preparing the request (debug build)
    note: "Most of the wait is request preparation on a debug build. Slow, but a separate issue."
    about: "10.6 s went into building the request on a debug build, before the provider was called. Not this bug; it has its own open question."
    check: q-prep
clusters:
  stops:
    label: 3 Stop presses
    sub: each re-read every journal before cancelling
    tone: warn
    about: "Each press scanned every journal under a shared lock, so later presses queued behind the first."
    fix: [c-runtime, c-ui]
    metric: [copy-first, copy-repeat, ui-feedback]
    check: step-hammer
    items:
      - id: stops-1
        label: 1st Stop press
        at: "10:09:05.3"
        dur: 3.5 s
        about: "One full scan of every journal under the lock before the cancel went out."
        metric: copy-first
      - id: stops-2
        label: 2nd Stop press
        at: "10:09:06.2"
        dur: 6.3 s
        about: "Pressed during the first scan, so it waited for the lock, then scanned everything again."
        metric: copy-repeat
      - id: stops-3
        label: 3rd Stop press
        at: "10:09:06.8"
        dur: 11.8 s
        note: "11.8 s with no feedback: this press queued behind two full journal scans."
        about: "Queued behind both earlier presses, with nothing on screen until the runtime finished."
        metric: [copy-repeat, ui-feedback]
story:
  - { sel: sent, note: "The turn starts here." }
  - { sel: prep, note: "Most of the first 11 s is request preparation on a debug build." }
  - { sel: e429, note: "The provider says 429 and the app paints it as final." }
  - { sel: c-429, note: "Now a 429 ends the turn at once, with no hidden retry." }
  - { sel: stops, note: "Three presses, each slower than the last." }
  - { sel: c-runtime, note: "Stop now reads each journal once and repeats are no-ops." }
  - { sel: copy-repeat, note: "A repeat press went from seconds to under a millisecond." }
  - { sel: step-hammer, note: "Press Stop many times to check it yourself." }
```

```change
id: fix
title: Root cause → fix
items:
  c-429:
    label: 429 settles
    was: '429 counted as "provider busy" → retries at 2 s, 10 s, 30 s, 2 min and 5 min, while the Stop square stays armed'
    now: "429 (any provider) ends the turn at once, with the same sentence and no hidden retry. A 5xx retry is never painted as final"
    verify: step-429
  c-runtime:
    label: runtime Stop is cheap
    was: Stop scanned and validated every journal under a shared lock before cancelling
    now: Thread relationships come from the existing index, each journal is read once, and a repeat press is a no-op
    affects: [copy-first, copy-repeat]
    verify: [step-early, step-tool]
  c-ui:
    label: UI reacts on the click
    was: The composer waited for the runtime and every press sent another cancel
    now: Send arrow and grey orb on the press frame. Repeats are ignored, and a new send waits for the cancel
    affects: ui-feedback
    verify: [step-stream, step-send]
```

::: split 3fr 2fr

```metrics
id: latency
title: Stop latency (runtime)
better: lower
rows:
  busy:
    label: Busy laptop, per press
    before: { text: 3.3–6.1 s, tone: warn }
    after: not re-measured live
    about: "Wall time from click to idle, read from the app log during the incident. Not repeated on the same machine after the fix."
  copy-first:
    label: Journal copy, first Stop
    before: 0.47–0.92 s
    after: 1.4 ms
    about: "Runtime benchmark over 160 journals, 20 runs each, before and after the change."
  copy-repeat:
    label: Journal copy, repeat press
    before: 0.73–1.72 s
    after: 0.8 ms
    about: "The same benchmark with a second Stop sent while the first is in flight."
  ui-feedback:
    label: UI feedback
    before: { text: after runtime + reread, tone: warn }
    after: { text: same frame, tone: ok }
    about: "Frame of the first visual change after the click, from a performance trace of the composer."
proof:
  - { label: Review, status: pass, value: "PASS, both follow-ups fixed before landing" }
  - { label: Unit tests · type check, status: pass, value: "307/307 · 0 errors" }
  - { label: Runtime focused, status: known, value: "412 pass · 4 fail (all fail on base too)" }
  - { id: proof-landed, label: After landing, status: pass, value: "270/270 unit · 59/59 runtime" }
  - { label: Not run, status: skip, value: "native app, live provider, full suites" }
```

```checklist
id: try
title: Try steps (restart `npm run dev`)
steps:
  step-stream:
    do: Long story, press Stop while it streams
    expect: the Send arrow appears on the click, with one grey notice and the text kept
    verifies: c-ui
  step-early:
    do: Press Stop before any words appear
    expect: idle right away
    verifies: c-runtime
  step-tool:
    do: Ask for something that runs a tool, and press Stop during the tool
    expect: no red "stopped" error
    verifies: c-runtime
  step-send:
    do: Press Stop, then send "try now" at once
    expect: the assistant answers it
    verifies: c-ui
  step-hammer:
    do: Hammer Stop
    expect: only the first press counts
    verifies: [c-runtime, c-ui]
  step-429:
    do: Next real 429
    expect: "one red row, then the Send arrow at once. Offline check:"
    code: cargo test -p app --lib http_429
open:
  q-5xx: { owner: Maintainer, decision: true, text: "should 5xx/529 also end the turn? (one line)", on: c-429 }
  q-prep: { text: "~10 s request prep on the debug build; its own ticket", on: prep }
  q-wording: { text: "429 wording now matches across providers", on: c-429 }
```

:::
