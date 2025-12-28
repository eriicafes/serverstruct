import { Box } from "getbox";
import { describe, expect, test, vi } from "vitest";
import { application, controller } from "../src";

class Counter {
  public count = 0;
  public increment() {
    this.count++;
  }
}

describe("Container", () => {
  test("controllers share the same box instance", async () => {
    const routeAction = vi.fn();
    const childRouteAction = vi.fn();

    const childController = controller((app, box) => {
      const counter = box.get(Counter);
      app.get("/", () => {
        childRouteAction(counter);
        counter.increment();
        return "ok";
      });
    });

    const box = new Box();
    const app = application((app, box) => {
      app.use(() => {
        const counter = box.get(Counter);
        routeAction(counter);
      });
      app.mount("", box.new(childController));
    }, box);

    await app.app.request("/");

    expect(routeAction.mock.lastCall?.[0]).not.toBeUndefined();
    expect(childRouteAction.mock.lastCall?.[0]).not.toBeUndefined();
    // Both should reference the same Counter instance
    expect(routeAction.mock.lastCall?.[0]).toBe(
      childRouteAction.mock.lastCall?.[0]
    );
    // Verify the counter was incremented
    expect(childRouteAction.mock.lastCall?.[0].count).toBe(1);
  });

  test("box.get() returns singleton instances", async () => {
    const getActions = vi.fn();

    const testController = controller((app, box) => {
      const counter1 = box.get(Counter);
      const counter2 = box.get(Counter);
      app.get("/", () => {
        getActions({ counter1, counter2 });
        return "ok";
      });
    });

    const app = application((app, box) => {
      app.mount("", box.new(testController));
    });

    await app.app.request("/");

    const { counter1, counter2 } = getActions.mock.lastCall?.[0];
    expect(counter1).toBe(counter2);
  });
});
