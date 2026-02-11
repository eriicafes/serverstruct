# Serverstruct OpenAPI

OpenAPI integration for [serverstruct](https://github.com/eriicafes/serverstruct) with [zod-openapi](https://github.com/samchungy/zod-openapi).

Define OpenAPI operations alongside your route handlers using Zod schemas. Request parameters and body are validated at runtime, and responses are fully typed.

## Installation

```sh
npm i zod zod-openapi
```

## Quick Start

```typescript
import { application } from "serverstruct";
import { z } from "zod";
import {
  createDocument,
  createRouter,
  jsonRequest,
  jsonResponse,
  OpenApiPaths,
} from "serverstruct/openapi";

const app = application((app, box) => {
  const router = createRouter(app, box.get(OpenApiPaths));

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
  const { paths } = box.get(OpenApiPaths);
  app.get("/docs", () =>
    createDocument({
      openapi: "3.1.0",
      info: { title: "My API", version: "1.0.0" },
      paths,
    }),
  );
});

app.serve({ port: 3000 });
```

## OpenApiPaths

`OpenApiPaths` collects operation definitions for document generation. Register operations by HTTP method and use the returned `RouterContext` for typed request handling.

Since `OpenApiPaths` is a class it can be used as a getbox singleton:

```typescript
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

### Methods

- `get(path, operation)` — Register a GET operation
- `post(path, operation)` — Register a POST operation
- `put(path, operation)` — Register a PUT operation
- `delete(path, operation)` — Register a DELETE operation
- `patch(path, operation)` — Register a PATCH operation
- `all(path, operation)` — Register for all standard methods
- `on(methods, path, operation)` — Register for specific methods

All methods return a `RouterContext`.

## OpenApiRouter

`OpenApiRouter` combines OpenAPI path registration with H3 route registration. It converts H3 path syntax (`:param`) to OpenAPI format (`{param}`) automatically. The handler function receives the `RouterContext` as its second argument.

```typescript
const app = application((app, box) => {
  const router = createRouter(app, box.get(OpenApiPaths));

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

Methods mirror `OpenApiPaths` but take an additional `handler` and optional `opts` parameter. All methods return `this` for chaining:

- `get(path, operation, handler, opts?)`
- `post(path, operation, handler, opts?)`
- `put(path, operation, handler, opts?)`
- `delete(path, operation, handler, opts?)`
- `patch(path, operation, handler, opts?)`
- `all(path, operation, handler, opts?)`
- `on(methods, path, operation, handler, opts?)`

## Path Conversion

`OpenApiRouter` automatically converts H3 path syntax to OpenAPI format:

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
