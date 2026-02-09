import {
  getQuery,
  getRouterParams,
  getValidatedQuery,
  getValidatedRouterParams,
  H3,
  H3Event,
  readBody,
  readValidatedBody,
  type EventHandlerResponse,
  type RouteOptions,
} from "h3";
import { type output } from "zod";
import type {
  ZodOpenApiMediaTypeObject,
  ZodOpenApiMetadata,
  ZodOpenApiOperationObject,
  ZodOpenApiPathsObject,
  ZodOpenApiRequestBodyObject,
  ZodOpenApiResponseObject,
} from "zod-openapi";
import { isAnyZodType } from "zod-openapi/api";

export {
  createDocument,
  type CreateDocumentOptions,
  type ZodOpenApiMetadata,
  type ZodOpenApiObject,
} from "zod-openapi";

// ---- Type inference utilities ----

/** Infer the Zod output type from `requestBody.content["application/json"].schema`. */
type InferBody<T> = T extends {
  requestBody: { content: { "application/json": { schema: infer S } } };
}
  ? output<S>
  : unknown;

/** Infer the Zod output type from `requestParams.path`. */
type InferParams<T> = T extends {
  requestParams: { path: infer S };
}
  ? output<S>
  : Record<string, string>;

/** Infer the Zod output type from `requestParams.query`. */
type InferQuery<T> = T extends {
  requestParams: { query: infer S };
}
  ? output<S>
  : Record<string, string>;

/** Resolve a response object from `responses` by numeric status code, handling both numeric and string keys. */
type LookupResponseByStatus<R, Status extends number> = Status extends keyof R
  ? R[Status]
  : `${Status}` extends keyof R
    ? R[`${Status}`]
    : never;

/** Infer the Zod output type from `responses[status].content["application/json"].schema`. */
type InferResponse<T, Status extends number> = T extends { responses: infer R }
  ? LookupResponseByStatus<R, Status> extends {
      content: { "application/json": { schema: infer S } };
    }
    ? output<S>
    : unknown
  : unknown;

/** Infer the Zod output type from `responses[status].headers`. Falls back to `Record<string, string>` when no headers schema is defined. */
type InferResponseHeaders<T, Status extends number> = T extends {
  responses: infer R;
}
  ? LookupResponseByStatus<R, Status> extends { headers: infer H }
    ? output<H>
    : Record<string, string>
  : Record<string, string>;

/** Extract the raw Zod schema from `requestBody.content["application/json"].schema`, or `undefined` if absent. */
type ExtractBodySchema<T> = T extends {
  requestBody: { content: { "application/json": { schema: infer S } } };
}
  ? S extends { _zod: any }
    ? S
    : undefined
  : undefined;

/** Extract the raw Zod schema from `requestParams.path`, or `undefined` if absent. */
type ExtractParamsSchema<T> = T extends {
  requestParams: { path: infer S };
}
  ? S extends { _zod: any }
    ? S
    : undefined
  : undefined;

/** Extract the raw Zod schema from `requestParams.query`, or `undefined` if absent. */
type ExtractQuerySchema<T> = T extends {
  requestParams: { query: infer S };
}
  ? S extends { _zod: any }
    ? S
    : undefined
  : undefined;

/** Extract the raw Zod schema from `requestParams.header`, or `undefined` if absent. */
type ExtractHeadersSchema<T> = T extends {
  requestParams: { header: infer S };
}
  ? S extends { _zod: any }
    ? S
    : undefined
  : undefined;

/** Extract numeric status codes from `responses`, normalizing string keys like `"200"` to `200`. */
type ResponseStatusKeys<T> = T extends { responses: infer R }
  ? keyof R extends infer K
    ? K extends number
      ? K
      : K extends `${infer N extends number}`
        ? N
        : never
    : never
  : never;

// ---- RouterContext ----

/**
 * Typed context returned from operation registration.
 *
 * Provides access to raw Zod schemas for manual validation and
 * convenience methods for extracting validated request data.
 *
 * - `schemas` — raw Zod schemas for use with h3 validation utilities (e.g. `getValidatedRouterParams`)
 * - `params()` — validates and returns route parameters
 * - `query()` — validates and returns query string parameters
 * - `body()` — validates and returns the JSON request body
 * - `reply()` — sets the response status, optional headers, and returns typed response data
 */
export type RouterContext<
  T extends ZodOpenApiOperationObject = ZodOpenApiOperationObject,
> = {
  schemas: {
    params: ExtractParamsSchema<T>;
    query: ExtractQuerySchema<T>;
    headers: ExtractHeadersSchema<T>;
    body: ExtractBodySchema<T>;
  };
  params(event: H3Event): Promise<InferParams<T>>;
  query(event: H3Event): Promise<InferQuery<T>>;
  body(event: H3Event): Promise<InferBody<T>>;
  reply<S extends ResponseStatusKeys<T>>(
    event: H3Event,
    status: S,
    data: InferResponse<T, S>,
    headers?: InferResponseHeaders<T, S>,
  ): InferResponse<T, S>;
};

function createContext<T extends ZodOpenApiOperationObject>(
  operation: T,
): RouterContext<T> {
  const paramsSchema = operation.requestParams?.path as ExtractParamsSchema<T>;
  const querySchema = operation.requestParams?.query as ExtractQuerySchema<T>;
  const headersSchema = operation.requestParams
    ?.header as ExtractHeadersSchema<T>;
  const bodyRawSchema =
    operation.requestBody?.content?.["application/json"]?.schema;
  const bodySchema = (
    isAnyZodType(bodyRawSchema) ? bodyRawSchema : undefined
  ) as ExtractBodySchema<T>;

  return {
    schemas: {
      params: paramsSchema,
      query: querySchema,
      headers: headersSchema,
      body: bodySchema,
    },
    params: (event) =>
      paramsSchema
        ? getValidatedRouterParams(event, paramsSchema)
        : Promise.resolve(getRouterParams(event) as InferParams<T>),
    query: (event) =>
      querySchema
        ? getValidatedQuery(event, querySchema)
        : Promise.resolve(getQuery(event) as InferQuery<T>),
    body: (event) =>
      (bodySchema
        ? readValidatedBody(event, bodySchema)
        : readBody(event)) as Promise<InferBody<T>>,
    reply: (event, status, data, headers) => {
      event.res.status = status;
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          event.res.headers.set(key, String(value));
        }
      }
      return data;
    },
  };
}

// ---- HTTP Methods ----

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

// ---- OpenApiPaths ----

/**
 * Collects OpenAPI operation definitions for document generation.
 *
 * Register operations by HTTP method and path. The accumulated `paths`
 * object can be passed to `createDocument()` to generate the OpenAPI spec.
 *
 * Each registration returns a typed {@link RouterContext} for use in route handlers.
 *
 * @example
 * ```ts
 * // Singleton via getbox DI
 * const paths = box.get(OpenApiPaths);
 *
 * const getPost = paths.get("/posts/{id}", { ... });
 *
 * // Generate OpenAPI document
 * createDocument({ openapi: "3.1.0", info: { ... }, paths: paths.paths });
 * ```
 */
export class OpenApiPaths {
  public paths: ZodOpenApiPathsObject = {};

  get<T extends ZodOpenApiOperationObject>(
    path: string,
    operation: T,
  ): RouterContext<T> {
    return this.register(path, "get", operation);
  }

  post<T extends ZodOpenApiOperationObject>(
    path: string,
    operation: T,
  ): RouterContext<T> {
    return this.register(path, "post", operation);
  }

  put<T extends ZodOpenApiOperationObject>(
    path: string,
    operation: T,
  ): RouterContext<T> {
    return this.register(path, "put", operation);
  }

  delete<T extends ZodOpenApiOperationObject>(
    path: string,
    operation: T,
  ): RouterContext<T> {
    return this.register(path, "delete", operation);
  }

  patch<T extends ZodOpenApiOperationObject>(
    path: string,
    operation: T,
  ): RouterContext<T> {
    return this.register(path, "patch", operation);
  }

  /** Register an operation for all standard HTTP methods (get, post, put, delete, patch). */
  all<T extends ZodOpenApiOperationObject>(
    path: string,
    operation: T,
  ): RouterContext<T> {
    return this.on(HTTP_METHODS, path, operation);
  }

  /** Register an operation for specific HTTP methods. */
  on<T extends ZodOpenApiOperationObject>(
    methods: readonly HttpMethod[],
    path: string,
    operation: T,
  ): RouterContext<T> {
    const item: Record<string, T> = {};
    for (const method of methods) {
      item[method] = operation;
    }
    this.paths[path] = { ...this.paths[path], ...item };
    return createContext(operation);
  }

  private register<T extends ZodOpenApiOperationObject>(
    path: string,
    method: HttpMethod,
    operation: T,
  ): RouterContext<T> {
    this.paths[path] = { ...this.paths[path], [method]: operation };
    return createContext(operation);
  }
}

// ---- OpenApiRouter ----

/**
 * Combines OpenAPI path registration with H3 route registration.
 *
 * Each method registers the operation in {@link OpenApiPaths} (converting the
 * H3 path syntax to OpenAPI format) and simultaneously registers the route
 * handler on the H3 app. The handler receives the typed {@link RouterContext}.
 *
 * @example
 * ```ts
 * const router = createRouter(app, box.get(OpenApiPaths));
 *
 * router.get("/posts/:id", {
 *   operationId: "getPost",
 *   requestBody: jsonRequest(inputSchema),
 *   responses: {
 *     200: jsonResponse(outputSchema, { description: "Success" }),
 *   },
 * }, async (event, ctx) => {
 *   const body = await ctx.body(event);
 *   return ctx.reply(event, 200, { message: "ok" });
 * });
 * ```
 */
export class OpenApiRouter {
  constructor(
    protected app: H3,
    protected paths: OpenApiPaths,
  ) {}

  get<T extends ZodOpenApiOperationObject>(
    path: string,
    operation: T,
    handler: (event: H3Event, ctx: RouterContext<T>) => EventHandlerResponse,
    opts?: RouteOptions,
  ) {
    const ctx = this.paths.get(toOpenApiPath(path), operation);
    this.app.get(path, (event) => handler(event, ctx), opts);
    return this;
  }

  post<T extends ZodOpenApiOperationObject>(
    path: string,
    operation: T,
    handler: (event: H3Event, ctx: RouterContext<T>) => EventHandlerResponse,
    opts?: RouteOptions,
  ) {
    const ctx = this.paths.post(toOpenApiPath(path), operation);
    this.app.post(path, (event) => handler(event, ctx), opts);
    return this;
  }

  put<T extends ZodOpenApiOperationObject>(
    path: string,
    operation: T,
    handler: (event: H3Event, ctx: RouterContext<T>) => EventHandlerResponse,
    opts?: RouteOptions,
  ) {
    const ctx = this.paths.put(toOpenApiPath(path), operation);
    this.app.put(path, (event) => handler(event, ctx), opts);
    return this;
  }

  delete<T extends ZodOpenApiOperationObject>(
    path: string,
    operation: T,
    handler: (event: H3Event, ctx: RouterContext<T>) => EventHandlerResponse,
    opts?: RouteOptions,
  ) {
    const ctx = this.paths.delete(toOpenApiPath(path), operation);
    this.app.delete(path, (event) => handler(event, ctx), opts);
    return this;
  }

  patch<T extends ZodOpenApiOperationObject>(
    path: string,
    operation: T,
    handler: (event: H3Event, ctx: RouterContext<T>) => EventHandlerResponse,
    opts?: RouteOptions,
  ) {
    const ctx = this.paths.patch(toOpenApiPath(path), operation);
    this.app.patch(path, (event) => handler(event, ctx), opts);
    return this;
  }

  /** Register a route and operation for all standard HTTP methods. */
  all<T extends ZodOpenApiOperationObject>(
    path: string,
    operation: T,
    handler: (event: H3Event, ctx: RouterContext<T>) => EventHandlerResponse,
    opts?: RouteOptions,
  ) {
    const ctx = this.paths.all(toOpenApiPath(path), operation);
    this.app.all(path, (event) => handler(event, ctx), opts);
    return this;
  }

  /** Register a route and operation for specific HTTP methods. */
  on<T extends ZodOpenApiOperationObject>(
    methods: readonly HttpMethod[],
    path: string,
    operation: T,
    handler: (event: H3Event, ctx: RouterContext<T>) => EventHandlerResponse,
    opts?: RouteOptions,
  ) {
    const ctx = this.paths.on(methods, toOpenApiPath(path), operation);
    for (const method of methods) {
      this.app.on(method, path, (event) => handler(event, ctx), opts);
    }
    return this;
  }
}

/** Create an {@link OpenApiRouter} that combines H3 route registration with OpenAPI path collection. */
export function createRouter(app: H3, paths: OpenApiPaths) {
  return new OpenApiRouter(app, paths);
}

// ---- Helpers ----

type Pretty<T> = { [K in keyof T]: T[K] } & {};
type Merge<T, U> = Omit<T, keyof U> & U;
type PrettyOmit<T, U extends keyof any> = Pretty<Omit<T, U>>;
type PrettyMerge<T, U> = Pretty<Merge<T, U>>;

/** Builder for OpenAPI metadata passed to `.meta()` on Zod schemas. */
export const metadata = (meta: ZodOpenApiMetadata) => meta;

/**
 * Build a typed `requestBody` object with `application/json` content.
 *
 * Additional media type options (e.g. `example`) can be passed via `opts.content`.
 *
 * @example
 * ```ts
 * jsonRequest(inputSchema)
 * jsonRequest(inputSchema, { description: "Create a post", content: { example: { title: "Hello" } } })
 * ```
 */
export function jsonRequest<
  S extends { _zod: any },
  O extends PrettyMerge<
    ZodOpenApiRequestBodyObject,
    { content?: PrettyOmit<ZodOpenApiMediaTypeObject, "schema"> }
  >,
>(
  schema: S,
  opts?: O,
): PrettyMerge<
  ZodOpenApiRequestBodyObject,
  {
    content: {
      "application/json": PrettyMerge<{ schema: S }, O["content"]>;
    };
  }
> {
  const { content, ...rest } = opts || {};
  return {
    required: true,
    ...rest,
    content: {
      "application/json": { schema, ...content } as PrettyMerge<
        { schema: S },
        O["content"]
      >,
    },
  };
}

/**
 * Build a typed response object with `application/json` content.
 *
 * Additional media type options (e.g. `example`) can be passed via `opts.content`.
 *
 * @example
 * ```ts
 * jsonResponse(outputSchema, { description: "Success" })
 * jsonResponse(outputSchema, {
 *   description: "Success",
 *   headers: z.object({ "x-request-id": z.string() }).meta({}),
 * })
 * ```
 */
export function jsonResponse<
  S extends { _zod: any },
  H extends { _zod: any } | undefined,
  O extends PrettyMerge<
    ZodOpenApiResponseObject,
    { content?: PrettyOmit<ZodOpenApiMediaTypeObject, "schema">; headers?: H }
  >,
>(
  schema: S,
  opts: O,
): PrettyMerge<
  ZodOpenApiResponseObject,
  {
    content: { "application/json": PrettyMerge<{ schema: S }, O["content"]> };
    headers: O["headers"];
  }
> {
  const { content, headers, ...rest } = opts;
  return {
    ...rest,
    headers,
    content: {
      "application/json": { schema, ...content } as PrettyMerge<
        { schema: S },
        O["content"]
      >,
    },
  };
}

// ---- Path utility ----

/**
 * Convert H3 path syntax to OpenAPI path syntax.
 *
 * - `/:name` → `/{name}`
 * - `/*`     → `/{param}`
 * - `/**`    → `/{path}`
 */
function toOpenApiPath(route: string): string {
  if (!route.startsWith("/")) route = "/" + route;

  return route
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        return `{${segment.slice(1)}}`;
      } else if (segment === "*") {
        return "{param}";
      } else if (segment === "**") {
        return "{path}";
      } else return segment;
    })
    .join("/");
}
