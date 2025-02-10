import { factory, Hollywood } from "hollywood-di";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { createModule } from "../src";

describe("Route", () => {
  const container = Hollywood.create({
    env: factory(() => "testing"),
  });

  const inner = createModule()
    .provide({
      env: factory(() => "testing inner"),
    })
    .route((app, container) => {
      return app.get("/env", (c) => c.json({ env: container.env }));
    });

  const custom = createModule(new Hono().basePath("sub"))
    .use<{ env: string }>()
    .route((app, container) => {
      return app.get("/env", (c) => c.json({ env: container.env }));
    });

  const app = createModule()
    .use<{ env: string }>()
    .submodules({ inner, custom })
    .route((app, container, modules) => {
      return app
        .get("/", (c) => c.text("success", 201))
        .get("/env", (c) => c.json({ env: container.env }))
        .route("/inner", modules.inner)
        .route("/custom", modules.custom);
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

  test("route uses custom app with base path", async () => {
    const res = await app.request("/custom/sub/env");
    expect(await res.json()).toStrictEqual({ env: "testing" });
  });
});
