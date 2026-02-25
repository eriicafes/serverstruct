# Serverstruct OpenAPI

OpenAPI integration for [serverstruct](https://github.com/eriicafes/serverstruct) with [zod-openapi](https://github.com/samchungy/zod-openapi).

Define OpenAPI operations alongside your route handlers using Zod schemas. Request parameters and body are validated at runtime, and responses are fully typed.

## Installation

```sh
npm i zod zod-openapi
```

## Quick Start

```typescript
import { application, serve } from "serverstruct";
import { z } from "zod";
import {
  createDocument,
  jsonRequest,
  jsonResponse,
  useRouter,
} from "serverstruct/openapi";

const app = application((app) => {
  const router = useRouter(app);

  router.post(
    "/posts",
    {
      operationId: "createPost",
      requestBody: jsonRequest(z.object({ title: z.string() })),
      responses: {
        201: jsonResponse(z.object({ title: z.string() }), {
          description: "Post created",
        }),
      },
    },
    async (event, ctx) => {
      const body = await ctx.body(event);
      // body is typed as { title: string }

      return ctx.reply(event, 201, { title: body.title });
    },
  );

  // Serve the OpenAPI document
  app.get("/docs", () =>
    createDocument({
      openapi: "3.1.0",
      info: { title: "My API", version: "1.0.0" },
      paths: router.paths(),
    }),
  );
});

serve(app, { port: 3000 });
```

## Router

`useRouter(app)` returns an `OpenApiRouter` that combines OpenAPI path registration with H3 route registration. Each method registers the operation on the OpenAPI paths and the handler on the H3 app simultaneously.

| Method                                  | Description                                       |
| --------------------------------------- | ------------------------------------------------- |
| `get(path, operation, handler)`         | Register a GET route                              |
| `post(path, operation, handler)`        | Register a POST route                             |
| `put(path, operation, handler)`         | Register a PUT route                              |
| `delete(path, operation, handler)`      | Register a DELETE route                           |
| `patch(path, operation, handler)`       | Register a PATCH route                            |
| `all(path, operation, handler)`         | Register a route for all standard HTTP methods    |
| `on(methods, path, operation, handler)` | Register a route for specific HTTP methods        |
| `route(...routes)`                      | Register standalone [`Route`](#route) definitions |
| `mount(base, sub)`                      | Mount a sub-app and include its OpenAPI paths     |
| `paths()`                               | Return the accumulated OpenAPI paths object       |

Use `router.mount()` to mount an app that has paths defined with `useRouter`.

```typescript
import { application, controller, serve } from "serverstruct";
import { z } from "zod";
import {
  createDocument,
  jsonRequest,
  jsonResponse,
  useRouter,
} from "serverstruct/openapi";

const postsController = controller((app) => {
  const router = useRouter(app);

  router.post(
    "/",
    {
      operationId: "createPost",
      requestBody: jsonRequest(z.object({ title: z.string() })),
      responses: {
        201: jsonResponse(z.object({ title: z.string() }), {
          description: "Post created",
        }),
      },
    },
    async (event, ctx) => {
      const body = await ctx.body(event);
      // body is typed as { title: string }

      return ctx.reply(event, 201, { title: body.title });
    },
  );
});

const app = application((app, box) => {
  const router = useRouter(app);

  router.mount("/posts", box.get(postsController));

  // Serve the OpenAPI document
  app.get("/docs", () =>
    createDocument({
      openapi: "3.1.0",
      info: { title: "My API", version: "1.0.0" },
      paths: router.paths(),
    }),
  );
});

serve(app, { port: 3000 });
```

## Route

`route()` creates a standalone route definition. Each route defines its HTTP method, path, operation, and handler together.

```typescript
import { application, serve } from "serverstruct";
import { z } from "zod";
import {
  jsonRequest,
  jsonResponse,
  route,
  useRouter,
} from "serverstruct/openapi";

const getPost = route({
  method: "get",
  path: "/posts/:id",
  operation: {
    operationId: "getPost",
    requestParams: {
      path: z.object({ id: z.string() }),
    },
    responses: {
      200: jsonResponse(postSchema, { description: "Post found" }),
    },
  },
  setup(box) {
    const db = box.get(Database); // db from Box
    return async (event, ctx) => {
      const { id } = await ctx.params(event);
      return ctx.reply(event, 200, await db.findPost(id));
    };
  },
});

const createPost = route({
  method: "post",
  path: "/posts",
  operation: {
    operationId: "createPost",
    requestBody: jsonRequest(z.object({ title: z.string() })),
    responses: {
      201: jsonResponse(postSchema, { description: "Post created" }),
    },
  },
  setup(box) {
    const db = box.get(Database);
    return {
      meta: { auth: true },
      async handler(event, ctx) {
        const body = await ctx.body(event);
        return ctx.reply(event, 201, await db.createPost(body));
      },
    };
  },
});

const app = application((app, box) => {
  const router = useRouter(app);

  const getPostRoute = box.get(getPost);
  const createPostRoute = box.get(createPost);

  router.route(getPostRoute, createPostRoute);
});

serve(app, { port: 3000 });
```

## Router Context

Every operation registration returns a `RouterContext` with typed request and response helpers.

### Schemas

`ctx.schemas` exposes the raw Zod schemas extracted from the operation, for use with H3 validation utilities directly:

```typescript
ctx.schemas.params; // requestParams.path schema
ctx.schemas.query; // requestParams.query schema
ctx.schemas.headers; // requestParams.header schema
ctx.schemas.cookies; // requestParams.cookie schema
ctx.schemas.body; // requestBody application/json schema
```

### Request Validation

`ctx.params()`, `ctx.query()`, and `ctx.body()` validate and parse incoming request data using the operation's schemas. When no schema is defined they return the raw value.

```typescript
router.post(
  "/posts/:id/comments",
  {
    operationId: "createComment",
    requestParams: {
      path: z.object({ id: z.coerce.number() }),
      query: z.object({ draft: z.coerce.boolean().optional() }),
    },
    requestBody: jsonRequest(z.object({ text: z.string().min(1) })),
    responses: { 201: jsonResponse(commentSchema, { description: "Created" }) },
  },
  async (event, ctx) => {
    const { id } = await ctx.params(event); // { id: number }
    const { draft } = await ctx.query(event); // { draft?: boolean }
    const body = await ctx.body(event); // { text: string }

    return ctx.reply(event, 201, await db.createComment(id, body, draft));
  },
);
```

A validation failure throws an `HTTPError` with status 400.

### Response Validation

`ctx.reply()` sets the response status and optional headers and returns typed response data. Types are inferred per status code from the operation's `responses` but not validated at runtime.

```typescript
return ctx.reply(event, 200, { id: "1", name: "Alice" });
return ctx.reply(
  event,
  200,
  { id: "1", name: "Alice" },
  { "x-request-id": "abc" },
);
```

`ctx.validReply()` works the same way but also validates the response body and headers against their schemas at runtime.

```typescript
return ctx.validReply(event, 201, { score: 85 });
// Throws a 500 HTTPError if the response does not match the schema
```

## OpenApiPaths

`OpenApiPaths` collects operation definitions for document generation. Register operations by HTTP method and use the returned `RouterContext` for typed request handling. Use `mount()` to merge paths from another `OpenApiPaths` instance under a base prefix.

```typescript
import { createDocument, OpenApiPaths } from "serverstruct/openapi";
import { getValidatedRouterParams } from "h3";

const usersPaths = new OpenApiPaths();

const getUser = usersPaths.get("/{id}", {
  operationId: "getUser",
  requestParams: {
    path: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: "User found",
      content: { "application/json": { schema: userSchema } },
    },
  },
});

const paths = new OpenApiPaths();
paths.mount("/users", usersPaths);
// /users/{id} is now in paths

const app = application((app) => {
  app.get("/users/:id", async (event) => {
    const params = await getValidatedRouterParams(
      event,
      getUser.schemas.params,
    );
    return getUser.reply(event, 200, { id: params.id, name: "Alice" });
  });

  // Serve the OpenAPI document
  app.get("/docs", () =>
    createDocument({
      openapi: "3.1.0",
      info: { title: "My API", version: "1.0.0" },
      paths: paths.paths,
    }),
  );
});
```

## Path Conversion

`useRouter` and `route()` both accept H3 path syntax and automatically convert it to OpenAPI format:

| H3       | OpenAPI    |
| -------- | ---------- |
| `/:name` | `/{name}`  |
| `/*`     | `/{param}` |
| `/**`    | `/{path}`  |

When using `OpenApiPaths` directly, paths should be written in OpenAPI format (`/users/{id}`).

## Helpers

### jsonRequest

Build a `requestBody` object with `application/json` content:

```typescript
{
  operationId: "createPost",
  requestBody: jsonRequest(
    z.object({ title: z.string() }),
  ),
}

// With additional options
{
  operationId: "createPost",
  requestBody: jsonRequest(
    z.object({ title: z.string() }),
    { description: "Create a post", content: { example: { title: "Hello" } } },
  ),
}
```

### jsonResponse

Build a response object with `application/json` content and optional headers:

```typescript
{
  operationId: "getUser",
  responses: {
    200: jsonResponse(userSchema, { description: "User found" }),
    404: jsonResponse(errorSchema, { description: "Not found" }),
  },
}

// With headers
{
  operationId: "getUser",
  responses: {
    200: jsonResponse(userSchema, {
      description: "User found",
      headers: z.object({ "x-request-id": z.string() }),
    }),
  },
}
```

### metadata

Zod's `.meta()` should accept `ZodOpenApiMetadata` directly, but if type inference is not working correctly you can use the `metadata` helper to ensure the correct type:

```typescript
const userSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .meta(
    metadata({
      description: "A user object",
      example: { id: "1", name: "Alice" },
    }),
  );
```

## Generating the Document

Use `createDocument` (re-exported from `zod-openapi`) with the accumulated paths:

```typescript
const app = application((app) => {
  const router = useRouter(app);

  // ... register routes ...

  app.get("/docs", () =>
    createDocument({
      openapi: "3.1.0",
      info: { title: "My API", version: "1.0.0" },
      paths: router.paths(),
    }),
  );
});
```

## Scalar API Reference

Serve an interactive API documentation UI powered by [Scalar](https://github.com/scalar/scalar).

```sh
npm i @scalar/core
```

```typescript
import { apiReference } from "serverstruct/openapi/scalar";

app.get("/reference", () =>
  apiReference({
    url: "http://localhost:3000/docs",
  }),
);
```

The `url` should point to the endpoint serving your OpenAPI document (see [Generating the Document](#generating-the-document) below).

## Client Type Generation

Use [openapi-typescript](https://openapi-ts.dev/) to generate TypeScript types from your running document endpoint:

```sh
npm i -D openapi-typescript
npx openapi-typescript http://localhost:3000/docs -o ./schema.ts
```

Then use [openapi-fetch](https://openapi-ts.dev/openapi-fetch/) to create a fully typed fetch client from the generated `paths` type:

```sh
npm i openapi-fetch
```

```typescript
import createClient from "openapi-fetch";
import type { paths } from "./schema.ts";

const client = createClient<paths>({ baseUrl: "http://localhost:3000" });

const { data, error } = await client.GET("/posts/{id}", {
  params: { path: { id: "1" } },
});
```

Request parameters, request body, and response data are all typed from the generated schema.
