# Serverstruct

⚡️ Typesafe and modular servers with [H3](https://github.com/unjs/h3).

Serverstruct provides simple helpers for building modular H3 applications with dependency injection using [getbox](https://github.com/eriicafes/getbox).

## Integrations

- [OpenAPI](./OPENAPI.md) - Typesafe OpenAPI operations with Zod schema validation.
- [OpenTelemetry](./OTEL.md) - Distributed tracing middleware for HTTP requests.

## Installation

```sh
npm i serverstruct h3 getbox
```

## Quick Start

```typescript
import { application, serve } from "serverstruct";

const app = application((app) => {
  app.get("/", () => "Hello world!");
});

serve(app, { port: 3000 });
```

## Application

`application()` creates an H3 instance.
A Box instance is created for the application and available as the second argument to the function.

You can mount other apps using `app.mount()`:

```typescript
import { H3 } from "h3";
import { application, serve } from "serverstruct";

class UserStore {
  public users: User[] = [];

  add(user: User) {
    this.users.push(user);
    return user;
  }
}

// Create an application
const usersApp = application((app, box) => {
  const store = box.get(UserStore);

  app.get("/", () => store.users);
});

// Mount in another app
const app = application((app) => {
  app.get("/", () => "Hello world!");
  app.mount("/users", usersApp);
});

serve(app, { port: 3000 });
```

When mounting a sub-app, all routes will be added with base prefix and global middleware will be added as one prefixed middleware.

Both `application()` and `controller()` can return a custom H3 instance:

```typescript
import { H3 } from "h3";

const customApp = application(() => {
  const app = new H3({
    onError: (error, event) => {
      console.error("Error:", error);
    },
  });
  app.get("/", () => "Hello from custom app!");
  return app;
});
```

**Note:** Sub-app options and global hooks are not inherited when mounted consider setting them in the main app directly.

## Controllers

Controllers are apps that are initialized with a parent Box instance, sharing the same dependency container. Use `controller()` to create H3 app constructors:

```typescript
import { application, controller } from "serverstruct";

// Create a controller
const usersController = controller((app, box) => {
  const store = box.get(UserStore);

  app.get("/", () => store.users);
  app.post("/", async (event) => {
    const body = await readBody(event);
    return store.add(body);
  });
});

// Use it in your main app
const app = application((app, box) => {
  const store = box.get(UserStore);

  app.get("/count", () => ({
    users: store.users.length,
  }));
  app.mount("/users", box.get(usersController));
});

serve(app, { port: 3000 });
```

## Handlers

Use `handler()` to create H3 handler constructors:

```typescript
import { application, handler } from "serverstruct";

// Define a handler
const getUserHandler = handler((event, box) => {
  const store = box.get(UserStore);

  const id = event.context.params?.id;
  return store.users.find((user) => user.id === id);
});

// Use it in your app
const app = application((app, box) => {
  app.get("/users/:id", box.get(getUserHandler));
});
```

### Event Handlers

Use `eventHandler()` to create H3 handler constructors with additional options like meta and middleware:

```typescript
import { application, eventHandler } from "serverstruct";

// Define an event handler with additional options
const getUserHandler = eventHandler((box) => ({
  handler(event) {
    const store = box.get(UserStore);

    const id = event.context.params?.id;
    return store.users.find((user) => user.id === id);
  },
  meta: { auth: true },
  middleware: [],
}));

// Use it in your app
const app = application((app, box) => {
  app.get("/users/:id", box.get(getUserHandler));
});
```

## Middleware

Use `middleware()` to create H3 middleware constructors:

```typescript
import { application, middleware } from "serverstruct";

class Logger {
  log(message: string) {
    console.log(message);
  }
}

// Define a middleware
const logMiddleware = middleware((event, next, box) => {
  const logger = box.get(Logger);
  logger.log("Request received");
});

// Use it in your app
const app = application((app, box) => {
  app.use(box.get(logMiddleware));
  app.get("/", () => "Hello world!");
});
```

> All middlewares defined with `app.use()` are global and execute before the matched handler in the exact order they are added to the app.

## Error Handling

Error handlers are middleware that catch errors thrown by `await next()`.

The last error handler defined executes before earlier ones. The error bubbles through each error handler until a response is returned or the default error response is sent.

> You can return or throw errors from handlers, but only `HTTPError` will be exposed to the client. All other errors produce a generic 500 response.

Use H3's `onError` helper to define error handlers:

```typescript
import { onError } from "h3";
import { application } from "serverstruct";

const app = application((app) => {
  app.use(
    onError((error) => {
      console.log("Error:", error);
    }),
  );
  app.get("/", () => {
    throw new Error("Oops");
  });
});
```

When the error handler needs access to the Box, wrap it with `middleware()`:

```typescript
import { onError } from "h3";
import { application, middleware } from "serverstruct";

const errorHandler = middleware((event, next, box) => {
  return onError((error) => {
    console.log("Error:", error);
  });
});

const app = application((app, box) => {
  app.use(box.get(errorHandler));
  app.get("/", () => {
    throw new Error("Oops");
  });
});
```

### Not Found Routes

To catch not found routes, define a catch-all handler and return the desired error:

```typescript
import { HTTPError } from "h3";

const app = application((app) => {
  app.get("/", () => "Hello world!");
  app.all("**", () => new HTTPError({ status: 404, message: "Not found" }));
});
```

Mounted apps can define their own not found handlers:

```typescript
const usersApp = application((app) => {
  app.get("/", () => ["Alice", "Bob"]);
  app.all(
    "**",
    () => new HTTPError({ status: 404, message: "User route not found" }),
  );
});

const app = application((app) => {
  app.mount("/users", usersApp);
  app.all("**", () => new HTTPError({ status: 404, message: "Not found" }));
});
```

## Box Instance

By default, `application()` creates a new Box instance. Pass a Box instance to reuse it:

```typescript
import { Box } from "getbox";
import { application, serve } from "serverstruct";

const box = new Box();

const app = application((app, box) => {
  const store = box.get(UserStore);

  app.get("/count", () => store.users.length);
  app.mount("/users", usersApp);
}, box);

serve(app, { port: 3000 });
```

If you need to pass a custom Box instance to an application it may be better to use a controller instead,
which is also easier to test.

```typescript
// app.ts
import { Box } from "getbox";
import { controller, serve } from "serverstruct";

export const appController = controller((app) => {
  const store = box.get(UserStore);

  app.get("/count", () => store.users.length);
  app.mount("/users", usersApp);
});

const box = new Box();
const app = box.get(appController);

serve(app, { port: 3000 });
```

## Context

`context()` creates a request-scoped, type-safe store for per-request values.

```typescript
import { application, context } from "serverstruct";

interface User {
  id: string;
  name: string;
}

// Create a context store
const userContext = context<User>();

const app = application((app) => {
  // Set context in middleware
  app.use((event) => {
    const user = { id: "123", name: "Alice" };
    userContext.set(event, user);
  });

  // Access context in handlers
  app.get("/profile", (event) => {
    // returns undefined if not set
    const maybeUser = userContext.lookup(event);

    // throws if not set
    const user = userContext.get(event);

    return { profile: user };
  });
});
```

### Context Methods

- `set(event, value)` - Store a value for the current request
- `get(event)` - Retrieve the value for the current request (throws if not found)
- `lookup(event)` - Retrieve the value or `undefined` if not found
