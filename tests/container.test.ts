import { scoped } from "hollywood-di";
import { describe, expect, test, vi } from "vitest";
import { createModule } from "../src";

class Counter {
  public count = 0;
}

describe("Container", () => {
  test("'use' reuses the parent container", async () => {
    const routeAction = vi.fn();
    const childRouteAction = vi.fn();

    const child = createModule()
      .use<{ counter: Counter }>()
      .route((app, container) => {
        return app.get("/", (c) => {
          childRouteAction(container.counter);
          return c.text("ok");
        });
      });

    const base = createModule()
      .provide({
        counter: scoped(Counter),
      })
      .submodules({ child })
      .route((app, container, modules) => {
        return app
          .use((_, next) => {
            routeAction(container.counter);
            return next();
          })
          .route("", modules.child);
      });

    await base.app().request("/");
    expect(routeAction.mock.lastCall?.[0]).not.toBeUndefined();
    expect(childRouteAction.mock.lastCall?.[0]).not.toBeUndefined();
    expect(routeAction.mock.lastCall?.[0]).toBe(
      childRouteAction.mock.lastCall?.[0]
    );
  });

  test("'provides' creates a child container", async () => {
    const routeAction = vi.fn();
    const childRouteAction = vi.fn();

    const child = createModule()
      .use<{ counter: Counter }>()
      .provide({})
      .route((app, container) =>
        app.get("/", (c) => {
          childRouteAction(container.counter);
          return c.text("ok");
        })
      );

    const base = createModule()
      .provide({
        counter: scoped(Counter),
      })
      .submodules({ child })
      .route((app, container, modules) =>
        app
          .use((_, next) => {
            routeAction(container.counter);
            return next();
          })
          .route("", modules.child)
      );

    await base.app().request("/");
    expect(routeAction.mock.lastCall?.[0]).not.toBeUndefined();
    expect(childRouteAction.mock.lastCall?.[0]).not.toBeUndefined();
    expect(routeAction.mock.lastCall?.[0]).not.toBe(
      childRouteAction.mock.lastCall?.[0]
    );
  });
});
