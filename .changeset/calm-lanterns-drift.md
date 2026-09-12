---
"serverstruct": minor
---

Add `onStart` and `onRequestOk` hooks to `traceMiddleware`, and a `ctx.durationMs` argument measuring request duration on `onRequestOk`/`onRequestError`/`onRequestEnd`.
