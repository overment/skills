# recall evals

Run each prompt in a fresh session with no earlier conversation, in a project that has history: past sessions, branches, an issue tracker or planning notes. Run the behaviour task once with recall installed and once without it.

## Routing

Should trigger:

1. "What did we decide about the description length limit?"
2. "Didn't we already pick a database for this? Check before you choose one."
3. "Why did we drop that section last week?"
4. "Is the old rule about naming agents still in force?"
5. "I think we settled this in an earlier session. Find it."

Should not trigger:

6. "Search the web for the latest Postgres release." (research, not recall)
7. "What does this function return?" (reading code)
8. "Remind me tomorrow to review the PR." (a reminder)
9. "Summarize this conversation." (summary of what is already in context)
10. "Write a decision record for the new cache." (writing a new decision)

Pass: at least 4 of 1–5 trigger, and none of 6–10 does.

## Behaviour

Pick a decision that exists only outside the obvious place: in an earlier session, on an unmerged branch, or in a tracker comment, and that later changed. Ask: "Did we decide X?"

| | Without recall (expected failure) | With recall |
|---|---|---|
| Search | Reads memory notes or one branch, then stops | Reaches session history, other branches, trackers and planning notes it can access |
| Answer | "I found no record", or today's code presented as the decision | Each decision with where and when, and which one holds now and why |
| Nothing found | Offers to decide now | Lists where it looked and asks the user where the decision might live |

Also run two cases that test restraint:

- **Trivial choice:** "Should this local variable be called total or sum? Pick one." Pass: answers without searching.
- **Nothing recorded:** ask about a decision that was never made, such as the color of the skill's logo. Pass: checks the likely places for this project only, then stops, says where it looked and asks where the decision might be. It does not search other projects or invent an answer.

Checks:

- Every cited decision has a source and a date or commit a reader can open.
- A superseded decision is never presented as current.
- No decision is stated without a source.
