# Serverstruct

⚡️ Typesafe and modular servers with [Hono](https://github.com/honojs/hono).

Serverstruct is a simple tool for building fast, modular and typesafe server applications.

It provides structure to your Hono application without any limitations. It also supports dependency injection using [Hollywood DI](https://github.com/eriicafes/hollywood-di).

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
import { createRoute } from "serverstruct";

const app = createRoute()
  .route((app) => {
    return app.get("/", (c) => c.text("Hello world!"));
  })
  .app();

export default app;
```

### An app with subroutes

```ts
import { createRoute } from "serverstruct";

// users routes
const users = createRoute().route((app) => {
  return app.get("/", (c) => c.text("users"));
});

// posts routes
const posts = createRoute().route((app) => {
  return app.get("/", (c) => c.text("posts"));
});

const app = createRoute()
  .subroutes({ users, posts })
  .route((app, container, routes) => {
    return app
      .get("/", (c) => c.text("Hello world!"))
      .route("/users", routes.users)
      .route("/posts", routes.posts);
  })
  .app();

export default app;
```

## Route

A route returns a new Hono app and may compose other routes with `subroutes<{ ... }>()`. If you intend to utilize dependency injection, a route can require it's dependencies with `use<{ ... }>()` and provide new dependencies with `provide({ ... })`. A route with dependencies can only be added as a subroute to another route if that route satisfies it's dependencies.

```ts
const auth = createRoute()
  .provide({
    // provide tokens here
  })
  .route((app) => {
    return app; // chain route handlers here
  });

const users = createRoute()
  .use({
    // define dependencies here
  })
  .route((app) => {
    return app; // chain route handlers here
  });

const posts = createRoute()
  .use({
    // define dependencies here
  })
  .provide({
    // provide tokens here
  })
  .route((app) => {
    return app; // chain route handlers here
  });

const app = createRoute()
  .subroutes({ auth, users, posts })
  .route((app, container, routes) => {
    return app
      .route("/auth", routes.auth)
      .route("/users", routes.users)
      .route("/posts", routes.posts);
  })
  .app();
```

Subroutes are not automatically registered. You will have to manually add the route for the desired path. This also allows for Hono's type inference through method chaining.

## Dependency Injection

Serverstruct is designed to work with [Hollywood DI](https://github.com/eriicafes/hollywood-di). Routes can define their dependencies using `use`, and also register new tokens using `provide` which creates a child container.

A root container can also be passed to the route. If no container is explicitly provided the first call to provide creates a root container and futher calls to provide will inherit from it.

### Use

Define route dependencies. The route can then only be used in a context that satisfies it's dependencies.

You can only call `use` once and only before calling `provide`.

```ts
interface Counter {
  count: number;
  increment(): void;
}

const route = createRoute()
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

// as a subroute
const app = createRoute()
  .provide({ counter: LinearCounter }) // the main app provides the dependency
  .subroutes({ countRoute: route })
  .route((app, _, routes) => {
    return app.route("/count", routes.countRoute);
  })
  .app();

// or as the main app
const container = Hollywood.create({ counter: LinearCounter }); // the container provides the dependency
const app = route.app(container);
```

Calling `Route.app()` returns the Hono instance from the route, therefore if the route has dependencies (by calling `use`), a container that satisfies those dependencies must be provided as seen in the example above.

### Provide

Provide creates a new child container. Registered tokens can then be used in the route and in futher calls to `provide`. See more about register tokens in [Hollywood DI](https://github.com/eriicafes/hollywood-di#tokens).

```ts
import { defineInit } from "hollywood-di";
import { createRoute } from "serverstruct";

class Foo {}
class Bar {
  public static init = defineInit(Bar).args("foo");

  constructor(public foo: Foo) {}
}

const route = createRoute()
  .provide({
    foo: Foo,
    bar: Bar,
  })
  .route((app, container) => {
    return app;
  });
```

## Incremental Adoption

Serverstruct can be added to an existing Hono app.

```ts
// routes/posts.ts
export const postsRoute = createRoute().route((app) => {
  return app.get("/", (c) => {
    return c.text("posts");
  });
});

import { Hono } from "hono";
import { createRoute } from "serverstruct";
import { postsRoute } from "./routes/posts";

const app = new Hono();

app.get("/", (c) => c.text("Hello world!"));
app.route("/posts", postsRoute.app());

export default app;
```
