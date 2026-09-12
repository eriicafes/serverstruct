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
  ATTR_HTTP_ROUTE,
  ATTR_SERVER_ADDRESS,
  ATTR_URL_FULL,
  ATTR_URL_PATH,
  ATTR_URL_QUERY,
  ATTR_URL_SCHEME,
  ATTR_USER_AGENT_ORIGINAL,
} from "@opentelemetry/semantic-conventions";
import { H3, HTTPError } from "h3";
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

  test("names span using the matched route template, not the concrete path", async () => {
    const app = new H3();
    app.use(traceMiddleware());
    app.get("/users/:id", () => ({ ok: true }));

    await app.request("/users/123");
    await app.request("/users/456");

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(2);
    expect(spans[0].name).toBe("GET /users/:id");
    expect(spans[1].name).toBe("GET /users/:id");
    expect(spans[0].attributes[ATTR_HTTP_ROUTE]).toBe("/users/:id");
  });

  test("falls back to pathname when no route matches", async () => {
    const app = new H3();
    app.use(traceMiddleware());
    app.get("/known", () => ({ ok: true }));

    await app.request("/unknown");

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("GET /unknown");
    expect(spans[0].attributes[ATTR_HTTP_ROUTE]).toBeUndefined();
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

  test("leaves span status unset for status codes < 500", async () => {
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
    expect(spans[0].status.code).toBe(SpanStatusCode.UNSET);
    expect(spans[1].status.code).toBe(SpanStatusCode.UNSET);
    expect(spans[2].status.code).toBe(SpanStatusCode.UNSET);
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
    const app = new H3({ silent: true });
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

  test("thrown HTTPError with status < 500 sets status code without marking span as error", async () => {
    const app = new H3({ silent: true });
    app.use(traceMiddleware());
    app.get("/protected", () => {
      throw new HTTPError({ status: 401, message: "Unauthorized" });
    });

    const res = await app.request("/protected");
    expect(res.status).toBe(401);

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBe(401);
    expect(spans[0].status.code).toBe(SpanStatusCode.UNSET);
    expect(spans[0].events).toHaveLength(0);
  });

  test("thrown HTTPError with status >= 500 marks span as error and records exception", async () => {
    const app = new H3({ silent: true });
    app.use(traceMiddleware());
    app.get("/broken", () => {
      throw new HTTPError({ status: 503, message: "Unavailable" });
    });

    const res = await app.request("/broken");
    expect(res.status).toBe(503);

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBe(503);
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0].events).toHaveLength(1);
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

  test("uses custom propagator to extract trace context", async () => {
    // Create a custom propagator that extracts trace context from headers
    const customPropagator: TextMapPropagator = {
      inject: () => {},
      extract: (ctx, carrier, getter) => {
        const traceId = getter.get(carrier, "x-trace-id");
        const spanId = getter.get(carrier, "x-span-id");

        if (traceId && spanId) {
          // Create and set a span context with the extracted IDs
          return trace.setSpanContext(ctx, {
            traceId: Array.isArray(traceId) ? traceId[0] : traceId,
            spanId: Array.isArray(spanId) ? spanId[0] : spanId,
            traceFlags: 1, // sampled
          });
        }
        return ctx;
      },
      fields: () => ["x-trace-id", "x-span-id"],
    };

    const app = new H3();
    app.use(
      traceMiddleware({
        propagation: {
          propagator: customPropagator,
        },
      }),
    );
    app.get("/test", () => ({ ok: true }));

    // Create valid test trace ID (32 hex chars) and span ID (16 hex chars)
    const testTraceId = "0af7651916cd43dd8448eb211c80319c";
    const testSpanId = "b7ad6b7169203331";

    await app.request("/test", {
      headers: {
        "x-trace-id": testTraceId,
        "x-span-id": testSpanId,
      },
    });

    const spans = await getFinishedSpans();
    expect(spans).toHaveLength(1);

    // Verify the span has the extracted trace ID
    expect(spans[0].spanContext().traceId).toBe(testTraceId);

    // Verify the span has the extracted span ID as its parent
    expect(spans[0].parentSpanContext?.spanId).toBe(testSpanId);
    expect(spans[0].parentSpanContext?.traceId).toBe(testTraceId);
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
        propagation: { disabled: true },
      }),
    );
    app.get("/test", () => ({ ok: true }));

    await app.request("/test");

    expect(extractSpy).not.toHaveBeenCalled();
    extractSpy.mockRestore();
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

  describe("skip", () => {
    test("does not create a span for requests matching the predicate", async () => {
      const app = new H3();
      app.use(traceMiddleware({ skip: (event) => event.path === "/healthz" }));
      app.get("/healthz", () => ({ ok: true }));
      app.get("/users/:id", () => ({ ok: true }));

      await app.request("/healthz");
      await app.request("/users/123");

      const spans = await getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("GET /users/:id");
    });

    test("does not run hooks for skipped requests", async () => {
      const onStart = vi.fn();
      const onRequestStart = vi.fn();
      const onRequestOk = vi.fn();
      const onRequestEnd = vi.fn();
      const app = new H3();
      app.use(
        traceMiddleware({
          skip: (event) => event.path === "/healthz",
          hooks: { onStart, onRequestStart, onRequestOk, onRequestEnd },
        }),
      );
      app.get("/healthz", () => ({ ok: true }));

      await app.request("/healthz");

      expect(onStart).not.toHaveBeenCalled();
      expect(onRequestStart).not.toHaveBeenCalled();
      expect(onRequestOk).not.toHaveBeenCalled();
      expect(onRequestEnd).not.toHaveBeenCalled();
    });

    test("still handles the request normally when skipped", async () => {
      const app = new H3();
      app.use(traceMiddleware({ skip: () => true }));
      app.get("/test", () => ({ ok: true }));

      const res = await app.request("/test");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });
  });

  describe("hooks", () => {
    test("is not called for skipped requests", async () => {
      const onStart = vi.fn();
      const app = new H3();
      app.use(traceMiddleware({ skip: () => true, hooks: { onStart } }));
      app.get("/test", () => ({ ok: true }));

      await app.request("/test");

      expect(onStart).not.toHaveBeenCalled();
    });

    test("calls onStart with just the event, before trace extraction and span creation", async () => {
      const order: string[] = [];
      const app = new H3();
      app.use(
        traceMiddleware({
          hooks: {
            onStart: (event) => {
              order.push(`start:${event.req.method}`);
            },
            onRequestStart: () => {
              order.push("requestStart");
            },
          },
        }),
      );
      app.get("/test", () => {
        order.push("handler");
        return { ok: true };
      });

      await app.request("/test");

      expect(order).toEqual(["start:GET", "requestStart", "handler"]);
    });

    test("onStart is called with no span argument", async () => {
      const onStart = vi.fn();
      const app = new H3();
      app.use(traceMiddleware({ hooks: { onStart } }));
      app.get("/test", () => ({ ok: true }));

      await app.request("/test");

      expect(onStart).toHaveBeenCalledTimes(1);
      expect(onStart.mock.calls[0]).toHaveLength(1);
    });

    test("onRequestStart, onRequestOk and onRequestEnd run inside the span context", async () => {
      const contexts: unknown[] = [];
      const app = new H3();
      app.use(
        traceMiddleware({
          hooks: {
            onRequestStart: (_event, span) => {
              contexts.push(trace.getSpan(context.active()) === span);
            },
            onRequestOk: (_event, span) => {
              contexts.push(trace.getSpan(context.active()) === span);
            },
            onRequestEnd: (_event, span) => {
              contexts.push(trace.getSpan(context.active()) === span);
            },
          },
        }),
      );
      app.get("/test", () => ({ ok: true }));

      await app.request("/test");

      expect(contexts).toEqual([true, true, true]);
    });

    test("onRequestError and onRequestEnd run inside the span context on error", async () => {
      const app = new H3({ silent: true });
      const matches: boolean[] = [];
      app.use(
        traceMiddleware({
          hooks: {
            onRequestError: (_event, span) => {
              matches.push(trace.getSpan(context.active()) === span);
            },
            onRequestEnd: (_event, span) => {
              matches.push(trace.getSpan(context.active()) === span);
            },
          },
        }),
      );
      app.get("/throw", () => {
        throw new Error("boom");
      });

      await app.request("/throw");

      expect(matches).toEqual([true, true]);
    });

    test("calls onRequestStart with the event and span before the request is handled", async () => {
      const onRequestStart = vi.fn();
      const app = new H3();
      app.use(traceMiddleware({ hooks: { onRequestStart } }));
      app.get("/test", () => ({ ok: true }));

      await app.request("/test");

      expect(onRequestStart).toHaveBeenCalledTimes(1);
      const [event, span] = onRequestStart.mock.calls[0];
      expect(event.req.method).toBe("GET");
      expect(span.spanContext().spanId).toBeDefined();
    });

    test("calls onRequestOk with the event, span, response and ctx.durationMs on success", async () => {
      const onRequestOk = vi.fn();
      const onRequestError = vi.fn();
      const app = new H3();
      app.use(traceMiddleware({ hooks: { onRequestOk, onRequestError } }));
      app.get("/test", (event) => {
        event.res.status = 201;
        return { ok: true };
      });

      await app.request("/test");

      expect(onRequestOk).toHaveBeenCalledTimes(1);
      const [, , response, ctx] = onRequestOk.mock.calls[0];
      expect(response.status).toBe(201);
      expect(typeof ctx.durationMs).toBe("number");
      expect(ctx.durationMs).toBeGreaterThanOrEqual(0);
      expect(onRequestError).not.toHaveBeenCalled();
    });

    test("calls onRequestEnd with the response set and error undefined on success, after onRequestOk", async () => {
      const order: string[] = [];
      const app = new H3();
      app.use(
        traceMiddleware({
          hooks: {
            onRequestOk: () => {
              order.push("ok");
            },
            onRequestEnd: (_event, _span, response, error, ctx) => {
              order.push("end");
              expect(response?.status).toBe(200);
              expect(error).toBeUndefined();
              expect(ctx.durationMs).toBeGreaterThanOrEqual(0);
            },
          },
        }),
      );
      app.get("/test", () => ({ ok: true }));

      await app.request("/test");

      expect(order).toEqual(["ok", "end"]);
    });

    test("calls onRequestError with the event, span, error and ctx.durationMs on thrown error, before onRequestEnd", async () => {
      const order: string[] = [];
      const app = new H3({ silent: true });
      app.use(
        traceMiddleware({
          hooks: {
            onRequestError: (_event, _span, error, ctx) => {
              order.push("error");
              expect(error).toBeInstanceOf(Error);
              expect((error as Error).message).toBe("boom");
              expect(typeof ctx.durationMs).toBe("number");
            },
            onRequestEnd: (_event, _span, response, error) => {
              order.push("end");
              expect(response).toBeUndefined();
              expect((error as Error).message).toBe("boom");
            },
            onRequestOk: () => {
              order.push("ok");
            },
          },
        }),
      );
      app.get("/throw", () => {
        throw new Error("boom");
      });

      const res = await app.request("/throw");
      expect(res.status).toBe(500);

      expect(order).toEqual(["error", "end"]);
    });

    test("onRequestOk and onRequestEnd share the same ctx.durationMs on success", async () => {
      let okDuration: number | undefined;
      let endDuration: number | undefined;
      const app = new H3();
      app.use(
        traceMiddleware({
          hooks: {
            onRequestOk: (_event, _span, _response, ctx) => {
              okDuration = ctx.durationMs;
            },
            onRequestEnd: (_event, _span, _response, _error, ctx) => {
              endDuration = ctx.durationMs;
            },
          },
        }),
      );
      app.get("/test", () => ({ ok: true }));

      await app.request("/test");

      expect(okDuration).toBe(endDuration);
    });

    test("ctx.durationMs is measured from immediately before onStart", async () => {
      let durationMs: number | undefined;
      const app = new H3();
      app.use(
        traceMiddleware({
          hooks: {
            onStart: async () => {
              await new Promise((resolve) => setTimeout(resolve, 30));
            },
            onRequestOk: (_event, _span, _response, ctx) => {
              durationMs = ctx.durationMs;
            },
          },
        }),
      );
      app.get("/test", () => ({ ok: true }));

      await app.request("/test");

      expect(durationMs).toBeGreaterThanOrEqual(30);
    });

    test("a failing onRequestOk does not trigger onRequestError, and onRequestEnd still runs exactly once", async () => {
      const onRequestError = vi.fn();
      const onRequestEnd = vi.fn();
      const app = new H3({ silent: true });
      app.use(
        traceMiddleware({
          hooks: {
            onRequestOk: () => {
              throw new Error("hook failure");
            },
            onRequestError,
            onRequestEnd,
          },
        }),
      );
      app.get("/test", () => ({ ok: true }));

      await app.request("/test");

      expect(onRequestError).not.toHaveBeenCalled();
      expect(onRequestEnd).toHaveBeenCalledTimes(1);
      const [, , response, error] = onRequestEnd.mock.calls[0];
      expect(response?.status).toBe(200);
      expect(error).toBeUndefined();
    });

    test("a failing onRequestError does not trigger onRequestOk, and onRequestEnd still runs exactly once", async () => {
      const onRequestOk = vi.fn();
      const onRequestEnd = vi.fn();
      const app = new H3({ silent: true });
      app.use(
        traceMiddleware({
          hooks: {
            onRequestOk,
            onRequestError: () => {
              throw new Error("hook failure");
            },
            onRequestEnd,
          },
        }),
      );
      app.get("/throw", () => {
        throw new Error("boom");
      });

      await app.request("/throw");

      expect(onRequestOk).not.toHaveBeenCalled();
      expect(onRequestEnd).toHaveBeenCalledTimes(1);
      const [, , response, error] = onRequestEnd.mock.calls[0];
      expect(response).toBeUndefined();
      expect((error as Error).message).toBe("boom");
    });

    test("a failing onRequestEnd does not trigger onRequestOk or onRequestError again", async () => {
      const onRequestOk = vi.fn();
      const onRequestError = vi.fn();
      const app = new H3({ silent: true });
      app.use(
        traceMiddleware({
          hooks: {
            onRequestOk,
            onRequestError,
            onRequestEnd: () => {
              throw new Error("hook failure");
            },
          },
        }),
      );
      app.get("/test", () => ({ ok: true }));

      await app.request("/test");

      expect(onRequestOk).toHaveBeenCalledTimes(1);
      expect(onRequestError).not.toHaveBeenCalled();
    });

    test("awaits async hooks", async () => {
      const order: string[] = [];
      const app = new H3();
      app.use(
        traceMiddleware({
          hooks: {
            onRequestStart: async () => {
              await Promise.resolve();
              order.push("start");
            },
            onRequestOk: async () => {
              await Promise.resolve();
              order.push("ok");
            },
            onRequestEnd: async () => {
              await Promise.resolve();
              order.push("end");
            },
          },
        }),
      );
      app.get("/test", () => {
        order.push("handler");
        return { ok: true };
      });

      await app.request("/test");

      expect(order).toEqual(["start", "handler", "ok", "end"]);
    });
  });
});
