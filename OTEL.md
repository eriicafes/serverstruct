# Serverstruct OpenTelemetry

OpenTelemetry distributed tracing integration for [serverstruct](https://github.com/eriicafes/serverstruct).

Automatically instrument HTTP requests with OpenTelemetry spans, capturing semantic convention attributes and enabling trace context propagation across microservices.

## Installation

```sh
npm i @opentelemetry/api @opentelemetry/semantic-conventions @opentelemetry/sdk-node @opentelemetry/resources @opentelemetry/exporter-trace-otlp-http
```

## Quick Start

```typescript
import { application } from "serverstruct";
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

const server = app.serve();

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

### Span Status Mapping

Status codes are automatically mapped to span statuses:

- 1xx-4xx: `SpanStatusCode.OK`
- 5xx: `SpanStatusCode.ERROR`

### Exception Recording

Exceptions thrown in route handlers are automatically recorded with full stack traces and set the span status to ERROR. The middleware rethrows errors after recording them, so they will still propagate to error handlers.

**Middleware Placement**:

- Place the tracing middleware **after** error handlers to record exceptions - the trace middleware will catch errors first, record them, then rethrow for error handlers.
- Place the tracing middleware **before** error handlers to skip exception recording - error handlers will catch errors before they reach the trace middleware.
- In all cases, span status is still set based on the HTTP response status code (1xx-4xx = OK, 5xx = ERROR).

## Configuration

### Custom Span Names

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

Enable distributed tracing across microservices by propagating trace context through HTTP headers.

```typescript
app.use(
  traceMiddleware({
    propagation: {
      // Extract trace context from incoming requests (default: true)
      request: true,

      // Inject trace context into outgoing responses (default: false)
      response: true,
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
