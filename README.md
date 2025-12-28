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

await app.serve({ port: 3000 });
```

## Composing Apps

Create modular h3 apps and mount them together:

```typescript
import { application } from "serverstruct";
import { H3 } from "h3";

// Create a users module
function createUsersApp() {
  const app = new H3();
  const users: User[] = [];

  app.get("/", () => users);
  app.post("/", async (event) => {
    const body = await readValidatedBody(event, validateUser);
    users.push(body);
    return body;
  });

  return app;
}

// Compose in main app
const app = application((app) => {
  app.get("/ping", () => "pong");
  app.mount("/users", createUsersApp());
});

await app.serve({ port: 3000 });
```

You can also create and return a new H3 instance:

```typescript
import { H3 } from "h3";

const app = application(() => {
  const customApp = new H3();
  customApp.get("/", () => "Hello from custom app!");
  return customApp;
});
```

## Controllers with Dependency Injection

Use `controller()` to create reusable modules with shared dependencies.

The `controller()` function integrates with [getbox](https://github.com/eriicafes/getbox) for dependency injection:

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

await app.serve({ port: 3000 });
```

The `box` parameter is a getbox `Box` instance that manages dependencies as singletons.

## Sharing Dependencies

Controllers can share dependencies using the `box` parameter.

Use `box.get(Class)` to retrieve or create a singleton instance:

```typescript
import { application, controller } from "serverstruct";

// A shared service
class Database {
  users: User[] = [];

  getUsers() { return this.users; }
  addUser(user: User) { this.users.push(user); }
}

// Controller uses box.get() to access the database
const usersController = controller((app, box) => {
  const db = box.get(Database);

  app.get("/", () => db.getUsers());
  app.post("/", async (event) => {
    const body = await readValidatedBody(event, validateUser);
    db.addUser(body);
    return body;
  });
});

// Another controller can access the same database
const statsController = controller((app, box) => {
  const db = box.get(Database);

  app.get("/count", () => ({ count: db.getUsers().length }));
});

const app = application((app, box) => {
  app.mount("/users", box.new(usersController));
  app.mount("/stats", box.new(statsController));
});

await app.serve({ port: 3000 });
```

**Key points:**
- `box.get(Class)` creates the instance on first call, then caches it
- `box.new(controller)` creates a fresh controller instance each time
- All controllers share the same Box instance
- All `box.get(Database)` calls return the same Database instance

## Middleware

Use h3's native middleware with `app.use()`:

```typescript
const app = application((app) => {
  // Global middleware
  app.use(() => console.log("Request received"));

  app.get("/", () => "Hello world!");
});
```

Controllers can have their own middleware:

```typescript
const usersController = controller((app) => {
  // Runs only for routes in this controller
  app.use(() => console.log("Users route accessed"));

  app.get("/", () => [...]);
  app.post("/", async () => {...});
});
```

## Advanced: Custom Box Instance

Pass your own Box instance to `application()` for more control:

```typescript
import { Box } from "getbox";

const box = new Box();

// Pre-populate with dependencies
Box.mock(box, Database, new Database());

const app = application((app, box) => {
  app.mount("/users", box.new(usersController));
}, box);
```

## API Reference

### `application(fn, box?)`

Creates an h3 application with DI support.

- **Parameters:**
  - `fn: (app: H3, box: Box) => H3 | void` - Configures the app
  - `box?: Box` - Optional Box instance (creates new one if not provided)
- **Returns:** `{ app: H3, serve: (options?) => Promise<Server> }`

### `controller(fn)`

Creates a getbox Constructor that produces an h3 app.

- **Parameters:**
  - `fn: (app: H3, box: Box) => H3 | void` - Configures the controller
- **Returns:** `Constructor<H3>` - Resolved via `box.new(controller)`
