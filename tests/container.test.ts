import { scoped } from "hollywood-di";
import { describe, expect, test, vi } from "vitest";
import { createRoute } from "../src";

class Counter {
  public count = 0;
}

describe("Container", () => {
  test("'use' reuses the parent container", async () => {
    const routeAction = vi.fn<[Counter]>();
    const childRouteAction = vi.fn<[Counter]>();

    const childRoute = createRoute()
      .use<{ counter: Counter }>()
      .route((app, container) =>
        app.get("/", (c) => {
          childRouteAction(container.counter);
          return c.text("ok");
        })
      );

    const route = createRoute()
      .provide({
        counter: scoped(Counter),
      })
      .subroutes({ child: childRoute })
      .route((app, container, routes) =>
        app
          .use((_, next) => {
            routeAction(container.counter);
            return next();
          })
          .route("", routes.child)
      );

    const _ = await route.app().request("/");
    expect(routeAction.mock.lastCall?.[0]).not.toBeUndefined();
    expect(childRouteAction.mock.lastCall?.[0]).not.toBeUndefined();
    expect(routeAction.mock.lastCall?.[0]).toBe(
      childRouteAction.mock.lastCall?.[0]
    );
  });

  test("'provides' creates a child container", async () => {
    const routeAction = vi.fn<[Counter]>();
    const childRouteAction = vi.fn<[Counter]>();

    const childRoute = createRoute()
      .use<{ counter: Counter }>()
      .provide({})
      .route((app, container) =>
        app.get("/", (c) => {
          childRouteAction(container.counter);
          return c.text("ok");
        })
      );

    const route = createRoute()
      .provide({
        counter: scoped(Counter),
      })
      .subroutes({ child: childRoute })
      .route((app, container, routes) =>
        app
          .use((_, next) => {
            routeAction(container.counter);
            return next();
          })
          .route("", routes.child)
      );

    route.app();
    const _ = await route.app().request("/");
    expect(routeAction.mock.lastCall?.[0]).not.toBeUndefined();
    expect(childRouteAction.mock.lastCall?.[0]).not.toBeUndefined();
    expect(routeAction.mock.lastCall?.[0]).not.toBe(
      childRouteAction.mock.lastCall?.[0]
    );
  });
});
