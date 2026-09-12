import {
  Attributes,
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
  type TextMapGetter,
  type TextMapPropagator,
  type Tracer,
} from "@opentelemetry/api";
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
import {
  defineMiddleware,
  getRequestURL,
  H3Event,
  HTTPError,
  toResponse,
} from "h3";
import { name, version } from "../package.json";

/**
 * Context passed to `onRequestOk`, `onRequestError` and `onRequestEnd` hooks.
 */
interface TraceRequestContext {
  /**
   * Milliseconds from trace start to the handler's response.
   */
  durationMs: number;
}

/**
 * Configuration options for OpenTelemetry trace middleware.
 */
interface TraceMiddlewareOptions {
  /**
   * Custom function to generate span names from H3 events.
   * Defaults to `{METHOD} {route}` (e.g., "GET /users/:id"), falling back to
   * `{METHOD} {pathname}` when no route has matched.
   */
  spanName?: (event: H3Event) => string;
  /**
   * Custom function to add additional span attributes from H3 events.
   * Called during span recording to enrich traces with application-specific data.
   */
  spanAttributes?: (event: H3Event) => Attributes;
  /**
   * Custom OpenTelemetry tracer instance.
   * Defaults to a tracer created from this package name and version.
   */
  tracer?: Tracer;
  /**
   * HTTP headers to capture as span attributes.
   */
  headers?: {
    /**
     * Request header names to capture (e.g., ["authorization", "x-api-key"]).
     * Values are recorded as `http.request.header.<name>` attributes.
     */
    request?: string[];
    /**
     * Response header names to capture (e.g., ["x-request-id", "x-rate-limit"]).
     * Values are recorded as `http.response.header.<name>` attributes.
     */
    response?: string[];
  };
  /**
   * Trace context propagation configuration.
   */
  propagation?: {
    /**
     * Disable extraction of trace context from incoming request headers.
     * Defaults to false.
     */
    disabled?: boolean;
    /**
     * Custom propagator for trace context extraction.
     * Defaults to the global OpenTelemetry propagator.
     */
    propagator?: TextMapPropagator;
  };
  /**
   * Lifecycle hooks for integrating other instrumentation (e.g. metrics,
   * logging).
   */
  hooks?: {
    /**
     * Runs before trace context extraction and span creation.
     * No span exists yet, so it doesn't run inside the span's context.
     * A thrown error propagates right away and is never recorded.
     * Otherwise, trace extraction and span creation continue.
     */
    onStart?: (event: H3Event) => void | Promise<void>;
    /**
     * Runs after the span starts, before the request is handled.
     * It runs inside the span's context.
     * A thrown error skips the request handler and gets recorded on the
     * span before propagating.
     * Otherwise the request handler runs next.
     */
    onRequestStart?: (event: H3Event, span: Span) => void | Promise<void>;
    /**
     * Runs for a successful response, before `onRequestEnd`.
     * It runs inside the span's context.
     * A thrown error here still lets `onRequestEnd` run first, then
     * replaces the response, gets recorded on the span, and propagates.
     * Otherwise `onRequestEnd` runs next.
     */
    onRequestOk?: (
      event: H3Event,
      span: Span,
      response: Response,
      ctx: TraceRequestContext,
    ) => void | Promise<void>;
    /**
     * Runs when a thrown error is caught, before it's rethrown and before
     * `onRequestEnd`.
     * It runs inside the span's context.
     * A thrown error here still lets `onRequestEnd` run first. It then
     * replaces the original error and gets recorded on the span before
     * propagating.
     * Otherwise `onRequestEnd` runs next.
     */
    onRequestError?: (
      event: H3Event,
      span: Span,
      error: unknown,
      ctx: TraceRequestContext,
    ) => void | Promise<void>;
    /**
     * Runs after `onRequestOk` or `onRequestError` runs or throws, with
     * exactly one of `response`/`error` set.
     * It runs inside the span's context.
     * A thrown error here replaces whatever `onRequestOk` or
     * `onRequestError` produced. It gets recorded on the span and
     * propagates.
     * Otherwise the handler response is returned on success, or the
     * handler error propagates on failure. If the last hook threw, its own
     * error propagates instead.
     */
    onRequestEnd?: (
      event: H3Event,
      span: Span,
      response: Response | undefined,
      error: unknown | undefined,
      ctx: TraceRequestContext,
    ) => void | Promise<void>;
  };
  /**
   * Skip tracing for requests matching this predicate (e.g. health checks).
   * When it returns true, the middleware calls `next()` directly without
   * creating a span or invoking any hooks.
   */
  skip?: (event: H3Event) => boolean;
}

/**
 * Creates an H3 middleware for OpenTelemetry distributed tracing.
 *
 * Automatically instruments HTTP requests with OpenTelemetry spans, capturing
 * the following semantic convention attributes:
 * - `http.request.method` - HTTP method
 * - `url.full` - Full request URL
 * - `url.path` - URL path
 * - `url.query` - Query string
 * - `url.scheme` - URL scheme
 * - `server.address` - Server host
 * - `user_agent.original` - User agent header
 * - `http.response.status_code` - Response status code
 * - `http.route` - Matched route template, when available
 * - `http.request.header.<name>` - Custom request headers
 * - `http.response.header.<name>` - Custom response headers
 *
 * Exceptions are recorded with full details when errors occur.
 *
 * Status codes are mapped to span statuses:
 * - 1xx-4xx: left unset (per OpenTelemetry conventions, `OK` is reserved for
 *   applications that set it deliberately)
 * - 5xx: SpanStatusCode.ERROR
 *
 * This applies uniformly whether the response was returned normally or the
 * status came from a thrown `HTTPError` (status defaults to 500 for other
 * thrown errors), so span status stays consistent regardless of whether an
 * `onError` handler downstream converts the error into a response.
 *
 * The middleware supports trace context propagation for distributed tracing across
 * microservices using OpenTelemetry propagators.
 *
 * @param options - Configuration options for tracing behavior
 * @returns H3 middleware function
 *
 * @example
 * ```ts
 * import { traceMiddleware } from "serverstruct/otel";
 *
 * // Default usage
 * app.use(traceMiddleware());
 *
 * // With options
 * app.use(traceMiddleware({
 *   headers: {
 *     request: ["authorization"],
 *     response: ["x-request-id"]
 *   },
 *   propagation: {
 *     disabled: true
 *   }
 * }));
 * ```
 */
export function traceMiddleware(options?: TraceMiddlewareOptions) {
  const tracer = options?.tracer ?? trace.getTracer(name, version);

  const requestHeaderAttrs = options?.headers?.request ?? [];
  const responseHeaderAttrs = options?.headers?.response ?? [];

  const propagator = options?.propagation?.propagator ?? propagation;
  const propagationDisabled = options?.propagation?.disabled ?? false;

  const getter: TextMapGetter<Headers> = {
    keys: (headers) => Array.from(headers.keys()),
    get: (headers, key) => headers.get(key) ?? undefined,
  };

  return defineMiddleware(async (event, next) => {
    if (options?.skip?.(event)) {
      return next();
    }

    const requestStart = performance.now();
    await options?.hooks?.onStart?.(event);

    // extract trace from request if not disabled
    const extractedCtx = propagationDisabled
      ? context.active()
      : propagator.extract(context.active(), event.req.headers, getter);

    const url = getRequestURL(event);
    if (url.username) url.username = "REDACTED";
    if (url.password) url.password = "REDACTED";

    const route = event.context.matchedRoute?.route;

    // start span
    const span = tracer.startSpan(
      options?.spanName?.(event) ??
        `${event.req.method} ${route ?? url.pathname}`,
      { kind: SpanKind.SERVER },
      extractedCtx,
    );
    const spanCtx = trace.setSpan(extractedCtx, span);
    const recording = span.isRecording();

    if (recording) {
      span.setAttribute(ATTR_HTTP_REQUEST_METHOD, event.req.method);
      span.setAttribute(ATTR_URL_FULL, event.req.url);
      span.setAttribute(ATTR_URL_PATH, url.pathname);
      if (url.search) span.setAttribute(ATTR_URL_QUERY, url.search.slice(1));
      span.setAttribute(ATTR_URL_SCHEME, url.protocol.replace(":", ""));
      span.setAttribute(ATTR_SERVER_ADDRESS, url.host);
      if (route) span.setAttribute(ATTR_HTTP_ROUTE, route);
      const userAgent = event.req.headers.get("user-agent");
      if (userAgent) span.setAttribute(ATTR_USER_AGENT_ORIGINAL, userAgent);

      // set request headers attributes
      for (const header of requestHeaderAttrs) {
        const value = event.req.headers.get(header);
        if (value != null) {
          span.setAttribute(ATTR_HTTP_REQUEST_HEADER(header.toLowerCase()), [
            value,
          ]);
        }
      }

      // set custom attributes
      if (options?.spanAttributes) {
        span.setAttributes(options.spanAttributes(event));
      }
    }

    try {
      const response = await context.with(spanCtx, async () => {
        await options?.hooks?.onRequestStart?.(event, span);

        let response: Response | undefined;
        let error: unknown;
        let hasError = false;
        try {
          const result = await next();
          if (result instanceof Error) throw result;
          response = await toResponse(result, event);
        } catch (err) {
          error = err;
          hasError = true;
        }

        const ctx: TraceRequestContext = {
          durationMs: performance.now() - requestStart,
        };

        try {
          if (hasError) {
            await options?.hooks?.onRequestError?.(event, span, error, ctx);
          } else {
            await options?.hooks?.onRequestOk?.(event, span, response!, ctx);
          }
        } finally {
          await options?.hooks?.onRequestEnd?.(
            event,
            span,
            response,
            error,
            ctx,
          );
        }

        if (hasError) throw error;
        return response!;
      });

      if (recording) {
        // set response attributes
        span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, response.status);
        if (response.status >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }

        // set response headers attributes
        for (const header of responseHeaderAttrs) {
          const value = response.headers.get(header);
          if (value != null) {
            span.setAttribute(ATTR_HTTP_RESPONSE_HEADER(header.toLowerCase()), [
              value,
            ]);
          }
        }
      }

      return response;
    } catch (err) {
      if (recording) {
        // resolve the status h3 will use to render this error, since it
        // hasn't rendered a response yet at this point in the middleware stack
        const status = HTTPError.isError(err) ? err.status : 500;
        span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, status);
        if (status >= 500) {
          const error = err instanceof Error ? err : new Error(String(err));
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: (err as Error)?.message,
          });
        }
      }
      throw err;
    } finally {
      // end span
      span.end();
    }
  });
}
