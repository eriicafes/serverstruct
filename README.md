# Serverstruct

⚡️ Typesafe and modular servers with [Hono](https://github.com/honojs/hono).

Serverstruct is a simple tool for building fast, modular and typesafe server applications with Hono and [Hollywood DI](https://github.com/eriicafes/hollywood-di).

## Installation

Serverstruct requires you to install hono.

```sh
npm i serverstruct hono
```

To make use of dependency injection provided by serverstruct, also install hollywood-di.

```sh
npm i serverstruct hono hollywood-di
```

## Usage

### A simple app

```ts
import { createModule } from "serverstruct";

const app = createModule()
  .route((app) => {
    return app.get("/", (c) => c.text("Hello world!"));
  })
  .app();

export default app;
```

### An app with submodules

```ts
import { createModule } from "serverstruct";

// users routes
const users = createModule().route((app) => {
  return app.get("/", (c) => c.text("users"));
});

// posts routes
const posts = createModule().route((app) => {
  return app.get("/", (c) => c.text("posts"));
});

const app = createModule()
  .submodules({ users, posts })
  .route((app, container, modules) => {
    return app
      .get("/", (c) => c.text("Hello world!"))
      .route("/users", modules.users)
      .route("/posts", modules.posts);
  })
  .app();

export default app;
```

## Module

A module is a Hono app that may require dependencies or provide dependencies of it's own. A module may compose other submodules. A module with dependencies can only be used as a submodule to another module if that module satisfies it's dependencies.

```ts
import { createModule } from "serverstruct";

const auth = createModule().route((app) => {
  return app; // chain route handlers here
});

const users = createModule().route((app) => {
  return app; // chain route handlers here
});

const app = createModule()
  .submodules({ auth, users })
  .route((app, container, modules) => {
    return app.route("/auth", modules.auth).route("/users", modules.users);
  })
  .app();
```

Submodules are not automatically added to the Hono app, you will have to manually mount each route. This helps in preserving Hono's type inference through method chaining.

You may also pass a custom Hono app to createModule.

```ts
import { Hono } from "hono";
import { createModule } from "serverstruct";

const auth = createModule(new Hono().basePath("/auth")).route((app) => {
  return app; // chain route handlers here
});

const users = createModule(new Hono().basePath("/users")).route((app) => {
  return app; // chain route handlers here
});

const app = createModule()
  .submodules({ auth, users })
  .route((app, container, modules) => {
    return app.route("", modules.auth).route("", modules.users);
  })
  .app();
```

## Dependency Injection

Serverstruct is designed to work with [Hollywood DI](https://github.com/eriicafes/hollywood-di). Modules can define their dependencies using `use`, and also register new tokens using `provide`.

A root container can also be passed to a module. If no container is explicitly provided the first call to provide creates a root container and futher calls to provide will inherit from it.

### Use

Define module dependencies. The module can then only be used in a context that satisfies it's dependencies.

You can only call `use` once and only before calling `provide`.

```ts
import { Hollywood } from "hollywood-di";
import { createModule } from "serverstruct";

interface Counter {
  count: number;
  increment(): void;
}

const countModule = createModule()
  .use<{ counter: Counter }>()
  .route((app, container) => {
    return app.get("/", (c) => {
      container.counter.increment();
      return c.text(`Count is: ${container.counter.count}`);
    });
  });

class LinearCounter {
  public count = 0;
  public increment() {
    this.count++;
  }
}

// as a submodule
const app = createModule()
  .provide({ counter: LinearCounter })
  .submodules({ count: countModule })
  .route((app, _, modules) => {
    return app.route("", modules.count);
  })
  .app();

// or as the main app
const container = Hollywood.create({ counter: LinearCounter });
const app = countModule.app(container);
```

Calling `Module.app()` returns the Hono app, so if the module has dependencies (by calling `use`), a container that satisfies those dependencies must be provided as seen in the example above.

### Provide

Provide creates a new child container. Registered tokens can then be used in the module and in futher calls to `provide`. See more about register tokens in [Hollywood DI](https://github.com/eriicafes/hollywood-di#tokens).

```ts
import { createModule } from "serverstruct";

class Foo {}
class Bar {
  constructor(public ctx: { foo: Foo }) {}
}

const module = createModule()
  .provide({
    foo: Foo,
    bar: Bar,
  })
  .module((app, container) => {
    return app;
  });
```

## Incremental Adoption

Serverstruct can be added to an existing Hono app.

```ts
// modules/posts.ts
import { createModule } from "serverstruct";

export const postsModule = createModule().route((app) => {
  return app.get("/", (c) => {
    return c.text("posts");
  });
});

// main.ts
import { Hono } from "hono";
import { postsModule } from "./modules/posts";

const app = new Hono();

app.get("/", (c) => c.text("Hello world!"));
app.route("/posts", postsModule.app());

export default app;
```
