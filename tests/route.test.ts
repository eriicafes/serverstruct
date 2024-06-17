import { factory, Hollywood } from "hollywood-di";
import { describe, expect, test } from "vitest";
import { createRoute } from "../src";

describe("Route", () => {
  const container = Hollywood.create({
    env: factory(() => "testing"),
  });

  const inner = createRoute()
    .provide({
      env: factory(() => "testing inner"),
    })
    .route((app, container) => {
      return app.get("/env", (c) => c.json({ env: container.env }));
    });

  const app = createRoute()
    .use<{ env: string }>()
    .subroutes({ inner })
    .route((app, container, routes) => {
      return app
        .get("/", (c) => c.text("success", 201))
        .get("/env", (c) => c.json({ env: container.env }))
        .route("/inner", routes.inner);
    })
    .app(container);

  test("matches routes", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("success");
  });

  test("route can access container", async () => {
    const res = await app.request("/env");
    expect(await res.json()).toStrictEqual({ env: "testing" });
  });

  test("route can access modified container", async () => {
    const res = await app.request("/inner/env");
    expect(await res.json()).toStrictEqual({ env: "testing inner" });
  });
});
