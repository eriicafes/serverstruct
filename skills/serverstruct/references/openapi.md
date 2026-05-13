# Serverstruct OpenAPI Reference

Use this when the task specifically involves `serverstruct/openapi`.

## Installation

```sh
npm i zod zod-openapi
```

## Main Rules

- Call `useRouter(app)` once per app and register all routes through the returned router.
- Do not mix `app.*` and `router.*` on the same app after `useRouter(app)`.
- All `router.mount()` signatures will include OpenAPI paths when the mounted app already has a router attached. Prefer `router.mount(box, { "/prefix": controllerCtor })` when mounting multiple controllers because it also resolves them from the shared Box.
- Keep routes inline in controllers by default. Use standalone `route()` only when a route genuinely needs extraction.
- Prefer a class to organize route schemas, using static properties named after each route's `operationId` and created with `schemas()`. Add extra schema properties when a route needs them such as error responses or alternate response shapes.

## Route Definition

When adding or editing routes, define the contract from the schemas first, then fill the OpenAPI operation from that contract.

- Enrich Zod schemas with useful constraints, defaults, examples, and metadata before wiring them into the route.
- Put request and response schemas in the route's `schemas()` object, then reference them from `requestParams`, `requestBody`, and `responses`.
- Fill the OpenAPI operation completely: `operationId`, request params, request body, success responses, and expected error responses.
- Keep the handler aligned with the declared contract by using `ctx.params()`, `ctx.query()`, `ctx.body()`, and `ctx.reply()` or `ctx.validReply()`.

## Typical Pattern

```typescript
import { controller } from "serverstruct";
import {
  jsonRequest,
  jsonResponse,
  schemas,
  useRouter,
} from "serverstruct/openapi";
import { z } from "zod";

class PostSchemas {
  static createPost = schemas({
    body: z.object({ title: z.string() }),
    response: z.object({ id: z.string(), title: z.string() }),
    badRequest: z.object({ message: z.string() }),
  });
}

const postsController = controller((app, box) => {
  const router = useRouter(app);
  const store = box.get(PostStore);

  router.post(
    "/",
    {
      operationId: "createPost",
      requestBody: jsonRequest(PostSchemas.createPost.body),
      responses: {
        201: jsonResponse(PostSchemas.createPost.response, {
          description: "Post created",
        }),
        400: jsonResponse(PostSchemas.createPost.badRequest, {
          description: "Bad request",
        }),
      },
    },
    async (event, ctx) => {
      const body = await ctx.body(event);
      return ctx.reply(event, 201, await store.create(body));
    },
  );
});
```

## Typed Helpers

- `ctx.params(event)` validates and parses path params
- `ctx.query(event)` validates and parses query params
- `ctx.body(event)` validates and parses JSON body
- `ctx.reply(event, status, body)` sets status and returns typed response data
- `ctx.validReply(...)` also validates the response at runtime

Validation failures become `HTTPError` 400 responses.

Common pitfall: do not use response schemas with output transforms when returning through `ctx.reply()`. `reply()` is type-only for responses and does not run runtime response parsing, so transformed output shapes are only enforced when using `ctx.validReply()`.

## Extracted Routes

Use `route()` when inline controller routes are not enough.

```typescript
const getPost = route({
  method: "get",
  path: "/posts/:id",
  operation: {
    operationId: "getPost",
    requestParams: { path: z.object({ id: z.string() }) },
    responses: {
      200: jsonResponse(postSchema, { description: "Success" }),
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
```
