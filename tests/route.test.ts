import { Box, constant } from "getbox";
import { H3 } from "h3";
import { describe, expect, test } from "vitest";
import { application, controller } from "../src";

describe("Route", () => {
  const EnvToken = constant("testing");
  const box = new Box();

  const innerController = controller((app, box) => {
    const env = box.get(EnvToken);
    app.get("/env", () => ({ env }));
  });

  const customController = controller((app, box) => {
    const customApp = new H3();
    const env = box.get(EnvToken);
    customApp.get("/sub/env", () => ({ env }));
    return customApp;
  });

  const app = application((app, box) => {
    const env = box.get(EnvToken);
    app.get("/", () => "success");
    app.get("/env", () => ({ env }));
    app.mount("/inner", box.new(innerController));
    app.mount("/custom", box.new(customController));
  }, box);

  test("matches routes", async () => {
    const res = await app.app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("success");
  });

  test("route can access box dependencies", async () => {
    const res = await app.app.request("/env");
    expect(await res.json()).toStrictEqual({ env: "testing" });
  });

  test("controller can access box dependencies", async () => {
    const res = await app.app.request("/inner/env");
    expect(await res.json()).toStrictEqual({ env: "testing" });
  });

  test("controller returns custom H3 app", async () => {
    // The custom app has basePath "sub", so routes are nested
    const res = await app.app.request("/custom/sub/env");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ env: "testing" });
  });

  test("serve returns a server instance", () => {
    const testApp = application((app) => {
      app.get("/", () => "test");
    });

    const server = testApp.serve({ manual: true });

    expect(server).toBeDefined();
    expect(typeof server.close).toBe("function");
    expect(typeof server.serve).toBe("function");
    expect(server.node).toBeDefined();
  });
});
