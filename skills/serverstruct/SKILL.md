---
name: serverstruct
description: Use when building an HTTP server with serverstruct — covers app structure, Box dependency injection, handlers and middleware, request context, testing, and where to look for OpenAPI, tracing, and getbox/context details.
---

# Serverstruct

## When to Use

Use this skill when the user wants to:

- create or modify a `serverstruct` HTTP server
- add routes, controllers, handlers, or middleware
- wire services with `getbox`
- test a serverstruct app with mocked dependencies

Open these references only when needed:

- `references/openapi.md` for `serverstruct/openapi`
- `references/otel.md` for tracing with `serverstruct/otel`
- `references/getbox-context.md` for AsyncLocalStorage-style dependency access when the project uses that pattern

## Core Guidance

Prefer `controller()` for the root app and all sub-apps when the app meaningfully uses Box or shared dependencies. `application()` still supports an external box or a `withBox()` scope, but `controller()` is usually less wiring and better matches the common DI-heavy structure.

Define routes inline inside controller setup. Resolve dependencies near the top of the setup closure and close over them in route handlers.

```typescript
import { controller } from "serverstruct";
import { HTTPError, readBody } from "h3";

const usersController = controller((app, box) => {
  const deps = box.get({ store: UserStore, logger: Logger });

  app.get("/", () => deps.store.getAll());
  app.get("/:id", (event) => {
    const user = deps.store.find(event.context.params!.id);
    if (!user) throw new HTTPError({ status: 404, message: "User not found" });
    return user;
  });
  app.post("/", async (event) => deps.store.add(await readBody(event)));
});
```

Use `handler()`, `eventHandler()`, and OpenAPI `route()` only when a route genuinely needs to be extracted from its controller. Handlers should throw `HTTPError` from `h3` when they need to return an HTTP failure response.

## Middleware, Context, Errors

Use `middleware()` for reusable custom middleware that needs Box or should be extracted from a controller. Use H3 lifecycle helpers like `onRequest()`, `onResponse()`, and `onError()` for lifecycle middleware. When those are defined inline in a controller, they already have access to the controller's Box-scoped dependencies through closure.

Middleware registered with `app.use()` runs globally before the matched handler in the same order it was added.

```typescript
import { middleware } from "serverstruct";
import { HTTPError, onError } from "h3";

const authMiddleware = middleware((event, next, box) => {
  const auth = box.get(AuthService);
  if (!auth.verify(event.headers.get("authorization"))) {
    throw new HTTPError({ status: 401 });
  }
});

const usersController = controller((app, box) => {
  const logger = box.get(Logger);

  app.use(onError((error) => logger.error(error)));
});
```

Use `context()` to pass typed per-request data between middleware and handlers.

```typescript
import { context } from "serverstruct";

const userCtx = context<User>({ onError: "Not authenticated" });

app.use((event) => userCtx.set(event, authenticate(event)));
app.get("/me", (event) => userCtx.get(event));
app.get("/try", (event) => userCtx.lookup(event));
```

Domain and service code should return domain results and leave HTTP concerns to handlers. Handlers should throw `HTTPError` from `h3` when they need to short-circuit the response.

Add a catch-all route at the end of the root app for not-found handling.

```typescript
app.all("**", () => new HTTPError({ status: 404, message: "Not found" }));
```

## Dependency Injection

Register shared state in Box, not module globals. Classes should declare dependencies in the constructor and wire them with `static init`.

Prefer PascalCase names for Box constructors, even when they come from `factory()`, `computed()`, or `constant()`. If a value is something you pass to `box.get()`, name it like a constructor.

```typescript
import { Box } from "getbox";

class UserService {
  constructor(
    private db: Database,
    private logger: Logger,
  ) {}

  static init = Box.init(UserService).get(Database, Logger);
}
```

If the value is a class, make it a valid getbox constructor. Otherwise use `factory()`, `computed()`, or `constant()` as needed.

## Testing

Mock dependencies on a `Box`, resolve the root controller from that box, and test with `app.request()`.

```typescript
import { Box } from "getbox";

const box = new Box();
Box.mock(box, UserStore, { getAll: () => [{ id: "1" }] });

const app = box.get(App);
const res = await app.request("/users");

expect(await res.json()).toEqual([{ id: "1" }]);
```

## Rules of Thumb

- Prefer `controller()` over `application()` once Box-backed composition matters.
- Resolve deps in controller setup before reaching for extracted handlers.
- Use `context()` for request-scoped data.
- Do not mix `app.*` and `router.*` on the same app after `useRouter(app)`.
- Start the OTel SDK before app imports and add `traceMiddleware()` after error handlers when you want exception recording.
