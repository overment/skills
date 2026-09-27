# context

What a model is sent on each call. One column per call lists every message that call sends, oldest first. A message keeps its row in every column, so the columns form a staircase that shows the list growing, and each call's reply sits in the row where the next call's first new message appears.

**Use when** the point is how an agent's or chatbot's context changes between calls: tool rounds, a growing conversation, why later calls cost more. Pair it with a `sequence` figure for who calls whom; the context block shows what each call carries.

```
 Call 1              Call 2               Call 3
 System  rules       System  rules        System  rules
 User    question    User    question     User    question
 Tool call  find()   Assistant find()     Assistant find()
                     Tool    result       Tool    result
                     Tool call  next()    Assistant next()
                                          Tool    result
                                          Answer  text        ← the loop ends
 2 messages          4 messages           6 messages
```

## Keys

```yaml
id: agent-context
title: What each call sends     # optional caption
for: agent-seq                  # optional: the sequence figure the calls belong to
items:                          # append-only, in order; a call sends everything above it
  - { id: sys, role: system, text: Instructions and tools, tokens: 900, about: "…" }
  - { id: ask, role: user, text: "Where is order 4417?", tokens: 9 }
  - { call: call-1, label: Call 1, message: m2, reply: "find_order(4417)", about: "…" }
  - { id: req, role: assistant, text: "find_order(4417)" }
  - { id: res, role: tool, text: "Shipped Tuesday" }
  - { call: call-2, message: m6, reply: "It shipped on Tuesday.", final: true }
notes: [...]                    # note markers sit in a message's first chip or a call's head
caveat: …
```

| Message key | Default | Meaning |
|---|---|---|
| `id` | required | Unique in the document |
| `role` | required | `system`, `user`, `assistant` or `tool`; drawn as the tag word, never a colour |
| `text` | required | What the message says, in a few words. Wraps to 2 lines at most (`label-fit` warns past that) |
| `tokens` | none | Give it on every message or none; with all of them each column shows the tokens it sends |
| `about`, `focal` | none, `false` | As for any mark |

| Call key | Default | Meaning |
|---|---|---|
| `call` | required | The call's id |
| `label` | `Call N` | Column head |
| `message` | none | The id of the message that makes this call elsewhere in the document, e.g. `m2` in a sequence. Selecting either lights the other. `ref-exists` errors when it doesn't exist |
| `reply` | required | What the model answered: a tool call, or the text that ends the loop |
| `final` | `false` | The reply is an answer and the loop ends here. Only the last call |
| `about`, `focal` | none, `false` | As for any mark |

- The list must start with a message and end with a call. A call that adds nothing since the previous one warns.
- **Budget:** at most 5 calls and 10 messages. Show the first rounds and the last rather than every one.
- **Drawing:** new since the previous call is an ink outline; sent again is a line outline with dim text. A reply is dashed (not in the list yet); the answer that ends the loop is a 2px ink box.
- **Card:** a message shows where it was first sent, in how many calls, and its tokens; a call shows messages sent, how many are new, its reply and tokens sent, with links to its sequence message and the calls before and after.

## Anti-patterns

- Pasting whole prompts or tool outputs into `text`. Name the message; put detail in `about`.
- A call per model turn of a long chat. Show the rounds that change the list in a way the reader needs.
- Colouring roles. The tag word carries the role; accent stays for `focal`.
