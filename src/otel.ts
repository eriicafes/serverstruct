import {
  Attributes,
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type TextMapGetter,
  type TextMapPropagator,
  type Tracer,
} from "@opentelemetry/api";
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
import { defineMiddleware, getRequestURL, H3Event, toResponse } from "h3";
import { name, version } from "../package.json";

/**
 * Configuration options for OpenTelemetry trace middleware.
 */
interface TraceMiddlewareOptions {
  /**
   * Custom function to generate span names from H3 events.
   * Defaults to `{METHOD} {pathname}` (e.g., "GET /users/123").
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
 * - `http.request.header.<name>` - Custom request headers
 * - `http.response.header.<name>` - Custom response headers
 *
 * Exceptions are recorded with full details when errors occur.
 *
 * Status codes are mapped to span statuses:
 * - 1xx-4xx: SpanStatusCode.OK
 * - 5xx: SpanStatusCode.ERROR
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
    // extract trace from request if not disabled
    const extractedCtx = propagationDisabled
      ? context.active()
      : propagator.extract(context.active(), event.req.headers, getter);

    const url = getRequestURL(event);
    if (url.username) url.username = "REDACTED";
    if (url.password) url.password = "REDACTED";

    // start span
    const span = tracer.startSpan(
      options?.spanName?.(event) ?? `${event.req.method} ${url.pathname}`,
      { kind: SpanKind.SERVER },
      extractedCtx,
    );
    const spanCtx = trace.setSpan(extractedCtx, span);
    const recording = span.isRecording();

    if (recording) {
      span.setAttribute(ATTR_HTTP_REQUEST_METHOD, event.req.method);
      span.setAttribute(ATTR_URL_FULL, event.req.url);
      span.setAttribute(ATTR_URL_PATH, url.pathname);
      if (url.search) {
        span.setAttribute(ATTR_URL_QUERY, url.search.slice(1));
      }
      span.setAttribute(ATTR_URL_SCHEME, url.protocol.replace(":", ""));
      span.setAttribute(ATTR_SERVER_ADDRESS, url.host);
      const userAgent = event.req.headers.get("user-agent");
      if (userAgent) {
        span.setAttribute(ATTR_USER_AGENT_ORIGINAL, userAgent);
      }

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
        const result = await next();
        return toResponse(result, event);
      });

      if (recording) {
        // set response attributes
        span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, response.status);
        span.setStatus({
          code:
            response.status < 500 ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        });

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
        // record exception
        const error = err instanceof Error ? err : new Error(String(err));
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error)?.message,
        });
      }
      throw err;
    } finally {
      // end span
      span.end();
    }
  });
}
