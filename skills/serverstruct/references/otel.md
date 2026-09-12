# Serverstruct OpenTelemetry Reference

Use this when the task specifically involves `serverstruct/otel`.

## Installation

```sh
npm i @opentelemetry/api @opentelemetry/semantic-conventions @opentelemetry/sdk-node @opentelemetry/resources @opentelemetry/exporter-trace-otlp-http
```

## Main Rules

- Start the OTel SDK before importing or constructing app code when early instrumentation matters.
- Add `traceMiddleware()` to the app to create request spans.
- Place `traceMiddleware()` after error handlers when exceptions should be recorded on spans before being rethrown.
- Shut down both the server and the SDK on process exit.

## Typical Pattern

```typescript
import { controller, serve } from "serverstruct";
import { traceMiddleware } from "serverstruct/otel";

sdk.start();

const App = controller((app) => {
  app.use(traceMiddleware());
});

const server = serve(box.get(App), { port: 3000 });

process.on("SIGTERM", async () => {
  await server.close();
  await sdk.shutdown();
});
```

## Useful Options

- `spanName(event)` to customize request span names
- `spanAttributes(event)` to add attributes
- `headers.request` / `headers.response` to capture selected headers
- `tracer` to provide a custom tracer
- `propagation.disabled` or `propagation.propagator` to control trace context extraction
- `hooks.onRequestStart` / `hooks.onRequestEnd` / `hooks.onRequestError` to hook other instrumentation (metrics, logging) into the request span lifecycle
- `skip(event)` to bypass tracing entirely for matching requests (no span, no hooks)

## Behavior Notes

- Default span name is `{method} {route}` using the matched route template (e.g. `GET /users/:id`); falls back to `{method} {pathname}` when no route matched. `http.route` is set when a route matched.
- 1xx-4xx status codes leave span status unset (`OK` is reserved for apps that set it deliberately)
- 5xx status codes map to `SpanStatusCode.ERROR`
- Thrown errors are resolved to a status the same way h3 will render them: a thrown `HTTPError` contributes its own `status`, anything else is treated as 500. That status applies the same 1xx-4xx/5xx rule above - a thrown 4xx `HTTPError` (e.g. from auth middleware) does NOT mark the span as an error, only >=500 does. Exceptions are recorded (with stack trace) only for >=500, and are always rethrown regardless.
