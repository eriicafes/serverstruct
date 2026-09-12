---
"serverstruct": minor
---

Add `hooks` option to `traceMiddleware` (`onRequestStart`, `onRequestEnd`, `onRequestError`) so callers can hook other instrumentation, like metrics or logging, into the request span lifecycle.
