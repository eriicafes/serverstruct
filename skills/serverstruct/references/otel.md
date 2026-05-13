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

## Behavior Notes

- 1xx-4xx status codes map to `SpanStatusCode.OK`
- 5xx status codes map to `SpanStatusCode.ERROR`
- thrown exceptions are recorded and then rethrown
