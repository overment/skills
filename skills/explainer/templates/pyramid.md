---
title: The testing pyramid
chrome: title
---

Most of the safety net should be [fast unit tests at the base](#test-pyramid-unit). Only a [few slow end-to-end tests at the top](#test-pyramid-end-to-end) prove that the main journeys still work.

```pyramid
id: test-pyramid
format: int
data:
  - { label: End-to-end, value: 40, about: "Drive the real app through a browser; slow and brittle, so keep them to the main journeys." }
  - { label: Contract, value: 120, about: "Check that each service still speaks the format its neighbours expect, without running them together." }
  - { label: Integration, value: 350, about: "Run one service with its real database and queue to catch wiring mistakes unit tests miss." }
  - { label: Unit, value: 2400, focal: true, about: "Check one function at a time in milliseconds, so they can run on every save." }
notes:
  - { on: test-pyramid-unit, text: "60 unit tests for every end-to-end test: 2,400 against 40." }
caveat: Counts are test cases in the main repository; a slow test that checks one function still counts as a unit test.
```
