---
"serverstruct": patch
---

Fix `traceMiddleware` marking spans as errors for thrown 4xx `HTTPError`s instead of only 5xx. Spans are also now named `{method} {route}` instead of `{method} {pathname}`.
