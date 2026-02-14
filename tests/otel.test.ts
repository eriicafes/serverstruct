import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  TextMapPropagator,
  trace,
} from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import {
  ATTR_HTTP_REQUEST_HEADER,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_HEADER,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_SERVER_ADDRESS,
  ATTR_URL_FULL,
  ATTR_URL_PATH,
  ATTR_URL_QUERY,
  ATTR_URL_SCHEME,
  ATTR_USER_AGENT_ORIGINAL,
} from "@opentelemetry/semantic-conventions";
import { H3 } from "h3";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { traceMiddleware } from "../src/otel";

describe("traceMiddleware", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;

  beforeAll(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  afterEach(() => {
    exporter.reset();
  });

  afterAll(async () => {
    await provider.shutdown();
  });

  async function getFinishedSpans() {
    await provider.forceFlush();
    return exporter.getFinishedSpans();
  }

  test("creates span with default name", async () => {
    const app = new H3();
    app.use(traceMiddleware());
    app.get("/users/123", () => ({ ok: true }));

    await app.request("/users/123");

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("GET /users/123");
    expect(spans[0].kind).toBe(SpanKind.SERVER);
  });

  test("creates span with custom name", async () => {
    const app = new H3();
    app.use(
      traceMiddleware({
        spanName: (event) => `Custom ${event.req.method}`,
      }),
    );
    app.get("/users", () => ({ ok: true }));

    await app.request("/users");

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("Custom GET");
  });

  test("handles multiple requests with separate spans", async () => {
    const app = new H3();
    app.use(traceMiddleware());
    app.get("/request1", () => ({ id: 1 }));
    app.get("/request2", () => ({ id: 2 }));

    await app.request("/request1");
    await app.request("/request2");

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(2);
    expect(spans[0].name).toBe("GET /request1");
    expect(spans[1].name).toBe("GET /request2");
  });

  test("sets custom span attributes", async () => {
    const app = new H3();
    app.use(
      traceMiddleware({
        spanAttributes: (event) => ({
          "custom.path": event.req.url,
          "custom.flag": true,
        }),
      }),
    );
    app.get("/test", () => ({ ok: true }));

    await app.request("/test");

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0].attributes;
    expect(attrs["custom.path"]).toBe("http://localhost/test");
    expect(attrs["custom.flag"]).toBe(true);
  });

  test("sets standard HTTP attributes", async () => {
    const app = new H3();
    app.use(traceMiddleware());
    app.get("/api/posts", () => ({ ok: true }));

    await app.request("/api/posts?page=2&limit=10", {
      headers: { "user-agent": "test-agent/1.0" },
    });

    let spans = await getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0].attributes;

    expect(attrs[ATTR_HTTP_REQUEST_METHOD]).toBe("GET");
    expect(attrs[ATTR_URL_FULL]).toBe(
      "http://localhost/api/posts?page=2&limit=10",
    );
    expect(attrs[ATTR_URL_PATH]).toBe("/api/posts");
    expect(attrs[ATTR_URL_QUERY]).toBe("page=2&limit=10");
    expect(attrs[ATTR_URL_SCHEME]).toBe("http");
    expect(attrs[ATTR_SERVER_ADDRESS]).toBe("localhost");
    expect(attrs[ATTR_USER_AGENT_ORIGINAL]).toBe("test-agent/1.0");

    await app.request("/api/posts");
    spans = await getFinishedSpans();
    expect(spans).toHaveLength(2);

    // works without query string
    expect(spans[1].attributes[ATTR_URL_QUERY]).toBeUndefined();

    // works without user-agent header
    expect(spans[1].attributes[ATTR_USER_AGENT_ORIGINAL]).toBeUndefined();
  });

  test("captures request headers", async () => {
    const app = new H3();
    app.use(
      traceMiddleware({
        headers: {
          request: ["authorization", "x-api-key"],
        },
      }),
    );
    app.get("/secure", () => ({ ok: true }));

    await app.request("/secure", {
      headers: {
        authorization: "Bearer token123",
        "x-api-key": "key456",
        "x-other": "ignored",
      },
    });

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0].attributes;

    expect(attrs[ATTR_HTTP_REQUEST_HEADER("authorization")]).toEqual([
      "Bearer token123",
    ]);
    expect(attrs[ATTR_HTTP_REQUEST_HEADER("x-api-key")]).toEqual(["key456"]);
    expect(attrs[ATTR_HTTP_REQUEST_HEADER("x-other")]).toBeUndefined();
  });

  test("captures response headers", async () => {
    const app = new H3();
    app.use(
      traceMiddleware({
        headers: {
          response: ["x-request-id", "x-rate-limit"],
        },
      }),
    );
    app.get("/test", (event) => {
      event.res.headers.set("x-request-id", "req-123");
      event.res.headers.set("x-rate-limit", "100");
      event.res.headers.set("x-other", "ignored");
      return { ok: true };
    });

    await app.request("/test");

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0].attributes;

    expect(attrs[ATTR_HTTP_RESPONSE_HEADER("x-request-id")]).toEqual([
      "req-123",
    ]);
    expect(attrs[ATTR_HTTP_RESPONSE_HEADER("x-rate-limit")]).toEqual(["100"]);
    expect(attrs[ATTR_HTTP_RESPONSE_HEADER("x-other")]).toBeUndefined();
  });

  test("sets response status code attribute", async () => {
    const app = new H3();
    app.use(traceMiddleware());
    app.post("/posts", (event) => {
      event.res.status = 201;
      return { id: "1" };
    });

    await app.request("/posts", { method: "POST" });

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBe(201);
  });

  test("maps status codes < 500 to OK", async () => {
    const app = new H3();
    app.use(traceMiddleware());
    app.get("/ok", () => ({ ok: true }));
    app.get("/created", (event) => {
      event.res.status = 201;
      return { id: "1" };
    });
    app.get("/bad-request", (event) => {
      event.res.status = 400;
      return { error: "bad" };
    });

    await app.request("/ok");
    await app.request("/created");
    await app.request("/bad-request");

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(3);
    expect(spans[0].status.code).toBe(SpanStatusCode.OK);
    expect(spans[1].status.code).toBe(SpanStatusCode.OK);
    expect(spans[2].status.code).toBe(SpanStatusCode.OK);
  });

  test("maps status codes >= 500 to ERROR", async () => {
    const app = new H3();
    app.use(traceMiddleware());
    app.get("/error", (event) => {
      event.res.status = 500;
      return { error: "internal" };
    });
    app.get("/unavailable", (event) => {
      event.res.status = 503;
      return { error: "unavailable" };
    });

    await app.request("/error");
    await app.request("/unavailable");

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(2);
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[1].status.code).toBe(SpanStatusCode.ERROR);
  });

  test("records exception and sets error status on thrown error", async () => {
    const app = new H3();
    app.use(traceMiddleware());
    app.get("/throw", () => {
      throw new Error("Something went wrong");
    });

    const res = await app.request("/throw");
    expect(res.status).toBe(500);

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0].status.message).toBe("Something went wrong");
    expect(spans[0].events).toHaveLength(1);
    expect(spans[0].events[0].name).toBe("exception");
  });

  test("does not record exception when error is caught in handler without throwing", async () => {
    const app = new H3();

    app.use(traceMiddleware());
    app.get("/throw", (event) => {
      try {
        throw new Error("Caught error");
      } catch {
        // Error caught and handled without re-throwing
        event.res.status = 503;
        return { error: "Service unavailable" };
      }
    });

    const res = await app.request("/throw");
    expect(res.status).toBe(503);

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(1);
    // Status code indicates error
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    // No exception recorded because error was caught before reaching middleware
    expect(spans[0].events).toHaveLength(0);
  });

  test("records exception when trace middleware is placed after error handler", async () => {
    const app = new H3();

    // Error handler first, then trace middleware
    app.use(async (event, next) => {
      try {
        return await next();
      } catch (err) {
        event.res.status = 503;
        return { error: "Service unavailable" };
      }
    });
    app.use(traceMiddleware());
    app.get("/throw", () => {
      throw new Error("Database error");
    });

    const res = await app.request("/throw");
    expect(res.status).toBe(503);

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(1);
    // Status code indicates error
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    // Trace middleware catches error first, records exception, then rethrows
    expect(spans[0].status.message).toBe("Database error");
    expect(spans[0].events).toHaveLength(1);
    expect(spans[0].events[0].name).toBe("exception");
  });

  test("uses custom propagator", async () => {
    // Create a custom propagator that modifies headers
    let extractedValue = "";
    const customPropagator: TextMapPropagator = {
      inject: (_context, carrier, setter) => {
        // Add suffix to the extracted value and inject it
        setter.set(carrier, "x-custom-trace", extractedValue + "-response");
      },
      extract: (context, carrier, getter) => {
        // Extract the trace header value
        const value = getter.get(carrier, "x-custom-trace");
        extractedValue = Array.isArray(value) ? value[0] : value || "";
        return context;
      },
      fields: () => ["x-custom-trace"],
    };

    const app = new H3();
    app.use(
      traceMiddleware({
        propagation: {
          request: true,
          response: true,
          propagator: customPropagator,
        },
      }),
    );
    app.get("/test", () => ({ ok: true }));

    const res = await app.request("/test", {
      headers: { "x-custom-trace": "trace-123" },
    });

    // Verify the custom propagator extracted and injected with suffix
    expect(res.headers.get("x-custom-trace")).toBe("trace-123-response");
  });

  test("extracts trace context from request headers by default", async () => {
    const extractSpy = vi.spyOn(propagation, "extract");

    const app = new H3();
    app.use(traceMiddleware());
    app.get("/test", () => ({ ok: true }));

    await app.request("/test", {
      headers: {
        traceparent: "00-trace-id-span-id-01",
      },
    });

    expect(extractSpy).toHaveBeenCalled();
    extractSpy.mockRestore();
  });

  test("does not extract trace context from request headers when disabled", async () => {
    const extractSpy = vi.spyOn(propagation, "extract");

    const app = new H3();
    app.use(
      traceMiddleware({
        propagation: { request: false },
      }),
    );
    app.get("/test", () => ({ ok: true }));

    await app.request("/test");

    expect(extractSpy).not.toHaveBeenCalled();
    extractSpy.mockRestore();
  });

  test("injects trace context into response headers when enabled", async () => {
    const injectSpy = vi.spyOn(propagation, "inject");

    const app = new H3();
    app.use(
      traceMiddleware({
        propagation: { response: true },
      }),
    );
    app.get("/test", () => ({ ok: true }));

    await app.request("/test");

    expect(injectSpy).toHaveBeenCalled();
    injectSpy.mockRestore();
  });

  test("does not inject trace context into response headers by default", async () => {
    const injectSpy = vi.spyOn(propagation, "inject");

    const app = new H3();
    app.use(traceMiddleware());
    app.get("/test", () => ({ ok: true }));

    await app.request("/test");

    expect(injectSpy).not.toHaveBeenCalled();
    injectSpy.mockRestore();
  });

  test("uses custom tracer when provided", async () => {
    const customTracer = trace.getTracer("custom-tracer", "1.0.0");

    const app = new H3();
    app.use(traceMiddleware({ tracer: customTracer }));
    app.get("/test", () => ({ ok: true }));

    await app.request("/test");

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].instrumentationScope.name).toBe("custom-tracer");
    expect(spans[0].instrumentationScope.version).toBe("1.0.0");
  });

  test("span context is available in route handlers", async () => {
    const app = new H3();
    app.use(traceMiddleware());
    app.get("/test", () => {
      const activeSpan = trace.getSpan(context.active());
      return { hasSpan: activeSpan !== undefined };
    });

    const res = await app.request("/test");
    const json = await res.json();

    expect(json.hasSpan).toBe(true);
  });

  test("nested spans inherit correct parent context", async () => {
    const app = new H3();
    app.use(traceMiddleware());
    app.get("/test", () => {
      const tracer = trace.getTracer("test");
      const childSpan = tracer.startSpan(
        "child-operation",
        { kind: SpanKind.INTERNAL },
        context.active(),
      );
      childSpan.end();
    });

    await app.request("/test");

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(2);

    // Find parent and child spans
    const parentSpan = spans.find((s) => s.name === "GET /test");
    const childSpan = spans.find((s) => s.name === "child-operation");

    expect(parentSpan).toBeDefined();
    expect(childSpan).toBeDefined();

    // Verify parent-child relationship
    expect(childSpan!.parentSpanContext?.spanId).toBe(
      parentSpan!.spanContext().spanId,
    );
  });
});
