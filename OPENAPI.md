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
  createRouter,
  jsonRequest,
  jsonResponse,
  OpenApiPaths,
} from "serverstruct/openapi";

const app = application((app, box) => {
  const paths = box.get(OpenApiPaths);
  const router = createRouter(app, paths);

  router.post(
    "/posts",
    {
      operationId: "createPost",
      requestBody: jsonRequest(
        z.object({ title: z.string() }).meta({ description: "New post input" }),
      ),
      responses: {
        201: jsonResponse(
          z.object({ id: z.string() }).meta({ description: "Created post" }),
          { description: "Post created" },
        ),
      },
    },
    async (event, ctx) => {
      const body = await ctx.body(event);
      // body is typed as { title: string }

      return ctx.reply(event, 201, { id: "1" });
    },
  );

  // Serve the OpenAPI document
  app.get("/docs", () =>
    createDocument({
      openapi: "3.1.0",
      info: { title: "My API", version: "1.0.0" },
      paths: paths.paths,
    }),
  );
});

serve(app, { port: 3000 });
```

## Use a Router

`OpenApiRouter` combines OpenAPI path registration with H3 route registration. The handler function receives the `RouterContext` as its second argument.

```typescript
const app = application((app, box) => {
  const paths = box.get(OpenApiPaths);
  const router = createRouter(app, paths);

  router.get(
    "/users/:id",
    {
      operationId: "getUser",
      requestParams: {
        path: z
          .object({ id: z.string() })
          .meta({ description: "User path parameters" }),
      },
      responses: {
        200: jsonResponse(userSchema, {
          description: "User found",
          headers: z
            .object({ "x-request-id": z.string() })
            .meta({ description: "Response headers" }),
        }),
        404: jsonResponse(errorSchema, { description: "Not found" }),
      },
    },
    async (event, ctx) => {
      const params = await ctx.params(event);
      const user = findUser(params.id);

      if (!user) {
        return ctx.reply(event, 404, { error: "not found" });
      }

      return ctx.reply(event, 200, user, {
        "x-request-id": crypto.randomUUID(),
      });
      // data and headers are typed per status code
    },
  );
});
```

## Use Routes

`route()` creates a standalone route constructor. Each route defines its HTTP method, path, operation, and handler together.

```typescript
import { application, serve } from "serverstruct";
import { z } from "zod";
import {
  createDocument,
  jsonRequest,
  jsonResponse,
  OpenApiPaths,
  route,
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
    const db = box.get(Database);
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
  const paths = box.get(OpenApiPaths);

  const getPostRoute = box.get(getPost);
  const createPostRoute = box.get(createPost);

  // Register multiple routes at once
  app.register(paths.routes(getPostRoute, createPostRoute));

  // Or register individually
  app.register(getPostRoute(paths));
});

serve(app, { port: 3000 });
```

## Route Context

Every operation registration returns a `RouterContext` with typed access to request data and helpers for sending responses.

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

## Manually Register Paths

`OpenApiPaths` collects operation definitions for document generation. Register operations by HTTP method and use the returned `RouterContext` for typed request handling.

Since `OpenApiPaths` is a class it can be used as a shared instance:

```typescript
import {
  getValidatedQuery,
  getValidatedRouterParams,
  readValidatedBody,
} from "h3";

const app = application((app, box) => {
  const paths = box.get(OpenApiPaths);

  const getUser = paths.get("/users/{id}", {
    operationId: "getUser",
    requestParams: {
      path: z
        .object({ id: z.string() })
        .meta({ description: "User path parameters" }),
    },
    responses: {
      200: {
        description: "User found",
        content: { "application/json": { schema: userSchema } },
      },
    },
  });

  app.get("/users/:id", async (event) => {
    const params = await getValidatedRouterParams(
      event,
      getUser.schemas.params,
    );
    const query = await getValidatedQuery(event, getUser.schemas.query);
    const body = await readValidatedBody(event, getUser.schemas.body);
    // getUser.schemas.headers and getUser.schemas.cookies are also available
    return getUser.reply(event, 200, { id: params.id, name: "Alice" });
  });
});
```

## Path Conversion

`OpenApiRouter` and `route()` both accept H3 path syntax and automatically convert it to OpenAPI format:

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
    z.object({ title: z.string() }).meta({ description: "New post input" }),
  ),
}

// With additional options
{
  operationId: "createPost",
  requestBody: jsonRequest(
    z.object({ title: z.string() }).meta({ description: "New post input" }),
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
      headers: z.object({ "x-request-id": z.string() }).meta({ description: "Response headers" }),
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
const app = application((app, box) => {
  const paths = box.get(OpenApiPaths);

  // ... register routes ...

  app.get("/docs", () =>
    createDocument({
      openapi: "3.1.0",
      info: { title: "My API", version: "1.0.0" },
      paths: paths.paths,
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
    url: "http://localhost:5000/docs",
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
