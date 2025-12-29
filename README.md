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

## Controllers

Use `controller()` to create h3 apps with `getbox` support:

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

### Sharing Dependencies

Controllers can share dependencies using the `box` parameter. Use `box.get(Class)` to retrieve or create a singleton instance:

```typescript
class Database {
  users: User[] = [];
}

const usersController = controller((app, box) => {
  const db = box.get(Database);
  app.get("/", () => db.users);
});

const statsController = controller((app, box) => {
  const db = box.get(Database);
  app.get("/count", () => ({ count: db.users.length }));
});

const app = application((app, box) => {
  app.mount("/users", box.new(usersController));
  app.mount("/stats", box.new(statsController));
});
```

Both controllers share the same `Database` instance.

## Handlers

Use `handler()` to create route handlers with `getbox` support:

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

## Middleware

Use `middleware()` to create middleware with `getbox` support:

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

## Custom Box Instance

Pass your own Box instance to `application()`:

```typescript
import { Box } from "getbox";

const box = new Box();

// Pre-populate with dependencies
Box.mock(box, Database, new Database());

const app = application((app, box) => {
  app.mount("/users", box.new(usersController));
}, box);
```
