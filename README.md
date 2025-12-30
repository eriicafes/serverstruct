# Serverstruct

⚡️ Typesafe and modular servers with [H3](https://github.com/unjs/h3).

Serverstruct provides simple helpers for building modular h3 applications with dependency injection using [getbox](https://github.com/eriicafes/getbox).

## Installation

```sh
npm i serverstruct h3 getbox
```

## Quick Start

```typescript
import { application } from "serverstruct";

const app = application((app) => {
  app.get("/", () => "Hello world!");
});

app.serve({ port: 3000 });
```

## Apps

Create modular h3 apps and mount them together:

```typescript
import { application } from "serverstruct";

// Create a users module
const { app: usersApp } = application((app) => {
  const users: User[] = [];

  app.get("/", () => users);
  app.post("/", async (event) => {
    const body = await readValidatedBody(event, validateUser);
    users.push(body);
    return body;
  });
});

// Compose in main app
const app = application((app) => {
  app.get("/ping", () => "pong");
  app.mount("/users", usersApp);
});

app.serve({ port: 3000 });
```

You can also create and return a new H3 instance to customize H3 options:

```typescript
import { H3 } from "h3";

const app = application(() => {
  const customApp = new H3({
    onError: (error) => {
      console.error(error);
    },
  });
  customApp.get("/", () => "Hello from custom app!");
  return customApp;
});
```

### Accessing the Box Instance

The `application()` function creates a new Box instance by default and returns it along with `app` and `serve`. You can access the box instance to retrieve dependencies:

```typescript
import { constant } from "getbox";

const Port = constant(5000);

const { box, serve } = application((app, box) => {
  app.get("/", () => "Hello world!");
});

const port = box.get(Port);
serve({ port });
```

## Controllers

Use `controller()` to create h3 app constructors:

```typescript
import { application, controller } from "serverstruct";

// Define a controller
const usersController = controller((app) => {
  const users: User[] = [];

  app.get("/", () => users);
  app.post("/", async (event) => {
    const body = await readValidatedBody(event, validateUser);
    users.push(body);
    return body;
  });
});

// Use it in your main app
const app = application((app, box) => {
  app.get("/ping", () => "pong");
  app.mount("/users", box.new(usersController));
});

app.serve({ port: 3000 });
```

## Handlers

Use `handler()` to create h3 handler constructors:

```typescript
import { application, handler } from "serverstruct";

class UserService {
  getUser(id: string) {
    return { id, name: "Alice" };
  }
}

// Define a handler
const getUserHandler = handler((event, box) => {
  const userService = box.get(UserService);
  const id = event.context.params?.id;
  return userService.getUser(id);
});

// Use it in your app
const app = application((app, box) => {
  app.get("/users/:id", box.get(getUserHandler));
});
```

### Event Handlers

Use `eventHandler()` to create h3 handlers with additional options like metadata and middleware:

```typescript
import { application, eventHandler } from "serverstruct";

class UserService {
  getUser(id: string) {
    return { id, name: "Alice" };
  }
}

// Define an event handler with middleware and metadata
const getUserHandler = eventHandler((box) => ({
  handler(event) {
    const userService = box.get(UserService);
    const id = event.context.params?.id;
    return userService.getUser(id);
  },
  meta: { auth: true },
  middleware: [
    (event) => {
      const token = event.headers.get("authorization");
      if (!token || token !== "secret-token") {
        throw new Error("Unauthorized");
      }
    },
  ],
}));

// Use it in your app
const app = application((app, box) => {
  app.get("/users/:id", box.get(getUserHandler));
});
```

## Middleware

Use `middleware()` to create h3 middleware constructors:

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

## Context

The `context()` function creates a request-scoped, type-safe store for per-request values. Each request gets its own isolated context that is automatically cleaned up when the request completes.

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
    const user = userContext.get(event);
    return { profile: user };
  });
});
```

### Context Methods

- `set(event, value)` - Store a value for the current request
- `get(event)` - Retrieve the value for the current request (throws if not found)
- `lookup(event)` - Retrieve the value or `undefined` if not found

```typescript
const requestIdContext = context<string>();

const app = application((app) => {
  app.use((event) => {
    requestIdContext.set(event, crypto.randomUUID());
  });

  app.get("/", (event) => {
    // Safe access - throws if not set
    const id = requestIdContext.get(event);

    // Optional access - returns undefined if not set
    const maybeId = requestIdContext.lookup(event);

    return { requestId: id };
  });
});
```

## Custom Box Instance

You can also pass your own Box instance to share dependencies across multiple applications or mock dependencies:

```typescript
import { Box } from "getbox";

const box = new Box();

// Mock a dependency
Box.mock(box, Database, new Database());

const app = application((app, box) => {
  app.mount("/users", box.new(usersController));
}, box);
```
