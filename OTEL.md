# Serverstruct OpenTelemetry

OpenTelemetry distributed tracing integration for [serverstruct](https://github.com/eriicafes/serverstruct).

Automatically instrument HTTP requests with OpenTelemetry spans, capturing semantic convention attributes and enabling trace context propagation across microservices.

## Installation

```sh
npm i @opentelemetry/api @opentelemetry/semantic-conventions @opentelemetry/sdk-node @opentelemetry/resources @opentelemetry/exporter-trace-otlp-http
```

## Quick Start

```typescript
import { application, serve } from "serverstruct";
import { traceMiddleware } from "serverstruct/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

// Initialize and start OpenTelemetry SDK
const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "my-api",
    [ATTR_SERVICE_VERSION]: "1.0.0",
  }),
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4318/v1/traces",
  }),
});
sdk.start();

const app = application((app) => {
  // Add tracing middleware
  app.use(traceMiddleware());

  app.get("/users/:id", async (event) => {
    // Spans are automatically created for each request
    return { id: event.context.params.id, name: "Alice" };
  });
});

const server = serve(app);

// Gracefully shutdown on exit
process.on("SIGTERM", async () => {
  await server.close();
  await sdk.shutdown();
  process.exit(0);
});
```

## Features

The middleware automatically captures the following [OpenTelemetry semantic convention](https://opentelemetry.io/docs/specs/semconv/http/http-spans/) attributes:

- `http.request.method` - HTTP method
- `url.full` - Full request URL
- `url.path` - URL path
- `url.query` - Query string (if present)
- `url.scheme` - URL scheme (http/https)
- `server.address` - Server host
- `user_agent.original` - User agent header (if present)
- `http.response.status_code` - Response status code
- `http.route` - Matched route template, when available (e.g. `/users/:id`)

### Span Naming

Spans are named `{method} {route}` by default (e.g. `GET /users/:id`), using the route template h3 matched before middleware runs. If no route matched (e.g. a 404), the span falls back to `{method} {pathname}`.

### Span Status Mapping

Status codes are automatically mapped to span statuses:

- 1xx-4xx: left unset (per the [OpenTelemetry HTTP semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-spans/), `OK` is reserved for applications that set it deliberately)
- 5xx: `SpanStatusCode.ERROR`

### Exception Recording

The middleware sees thrown errors before h3 has turned them into a response, so it resolves the status the same way h3 will: a thrown `HTTPError` contributes its own `status`, any other thrown value is treated as a 500. That status is recorded on the span either way. Only statuses >= 500 record the exception (with full stack trace) and set the span status to ERROR - a thrown `HTTPError` with a 4xx status (e.g. a 401 from auth middleware) is recorded as a normal 4xx response, not a span error. The middleware always rethrows after recording, so errors still propagate to error handlers.

**Middleware Placement**:

- Place the tracing middleware **after** error handlers to record exceptions - the trace middleware will catch errors first, record them, then rethrow for error handlers.
- Place the tracing middleware **before** error handlers to skip exception recording - error handlers will catch errors before they reach the trace middleware.
- In all cases, span status is based on the status the trace middleware resolves when it catches the error, not on what a downstream `onError` handler later returns.

## Configuration

### Custom Span Names

The default `{method} {route}` naming (see [Span Naming](#span-naming)) covers most use cases. Provide `spanName` only when you need something different:

```typescript
app.use(
  traceMiddleware({
    spanName: (event) => `${event.req.method} ${event.path}`,
  }),
);
```

### Custom Span Attributes

```typescript
app.use(
  traceMiddleware({
    spanAttributes: (event) => ({
      "service.name": "my-api",
      "deployment.environment": process.env.NODE_ENV,
      "request.id": event.req.headers.get("x-request-id"),
    }),
  }),
);
```

### Capture Request/Response Headers

```typescript
app.use(
  traceMiddleware({
    headers: {
      request: ["authorization", "x-api-key"],
      response: ["x-request-id", "x-rate-limit"],
    },
  }),
);
```

Headers are captured as:

- `http.request.header.<name>` for request headers
- `http.response.header.<name>` for response headers

### Custom Tracer

```typescript
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("my-service", "1.0.0");

app.use(traceMiddleware({ tracer }));
```

### Trace Context Propagation

Enable distributed tracing across microservices by extracting trace context from incoming HTTP headers (enabled by default).

```typescript
app.use(
  traceMiddleware({
    propagation: {
      // Disable extraction of trace context from incoming requests (default: false)
      disabled: false,
    },
  }),
);
```

### Custom Propagator

Use a custom propagator for trace context extraction/injection:

```typescript
import { W3CTraceContextPropagator } from "@opentelemetry/core";

app.use(
  traceMiddleware({
    propagation: {
      propagator: new W3CTraceContextPropagator(),
    },
  }),
);
```

### Hooks

Use `hooks` to integrate other instrumentation (metrics, logging, etc.) with the request span, without re-implementing the status/error resolution the middleware already does. `onRequestStart`, `onRequestOk`, `onRequestEnd` and `onRequestError` run inside the span's context, so `trace.getSpan(context.active())` resolves to it and any spans they start are parented to it:

```typescript
app.use(
  traceMiddleware({
    hooks: {
      // called first, before trace context extraction and span creation -
      // useful for request timing
      onStart: (event) => {
        metrics.requestsReceived.add(1);
      },
      // called after the span starts, before the request is handled
      onRequestStart: (event, span) => {
        metrics.requestsStarted.add(1, { route: event.path });
      },
      // called after a successful response is produced, before onRequestEnd
      onRequestOk: (event, span, response, ctx) => {
        metrics.requestDuration.record(ctx.durationMs, {
          route: event.path,
          status: response.status,
        });
      },
      // called when the middleware catches a thrown error, before it
      // rethrows and before onRequestEnd
      onRequestError: (event, span, error, ctx) => {
        metrics.requestsFailed.add(1, { route: event.path });
      },
      // always called last, exactly once, regardless of whether
      // onRequestOk/onRequestError threw
      onRequestEnd: (event, span, response, error, ctx) => {
        const { traceId } = span.spanContext();
        logger.info("request completed", {
          traceId,
          status: response?.status,
          durationMs: ctx.durationMs,
        });
      },
    },
  }),
);
```

`onStart` runs before span creation, so it has no span argument - use `onRequestStart` for hooks that need one. It's not called for skipped requests (see [Skipping Requests](#skipping-requests)). `onRequestOk`, `onRequestError` and `onRequestEnd` receive a final `ctx` argument with `durationMs`, the time elapsed since the middleware started handling the request.

### Skipping Requests

Skip tracing entirely for certain requests:

```typescript
app.use(
  traceMiddleware({
    skip: (event) => event.path === "/healthz",
  }),
);
```

## Creating Child Spans

Create child spans for operations like database queries or external API calls:

```typescript
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("my-service");

app.get("/users/:id", async (event) => {
  const userId = event.context.params.id;

  // Create a child span for database operation
  return await tracer.startActiveSpan("db.query", async (span) => {
    try {
      const user = await db.getUser(userId);
      span.setAttributes({
        "db.operation": "SELECT",
        "db.table": "users",
      });
      return user;
    } finally {
      span.end();
    }
  });
});
```

## Learn More

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [OpenTelemetry JavaScript SDK](https://github.com/open-telemetry/opentelemetry-js)
- [Semantic Conventions for HTTP](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)
